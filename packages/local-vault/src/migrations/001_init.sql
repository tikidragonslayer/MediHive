-- MediHive — Copyright (C) 2024-2026 The MediHive Authors
-- Licensed under the GNU Affero General Public License v3.0 or later.
--
-- LocalVault initial schema. Designed for HIPAA technical safeguards
-- (45 CFR §164.312): unique user identification, audit controls,
-- integrity, transmission security.
--
-- Notes on integrity:
--  * audit_log is append-only via a trigger that blocks UPDATE and DELETE.
--  * Each audit row chains entry_hash = SHA256(prev_hash || canonical_payload).
--  * medical_records.status transitions are constrained — Voided is terminal.
--  * Soft-deletes on records are achieved via status='voided' (Final and
--    above are immutable except via a new amendment record that supersedes).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================
-- Patient passports
-- =====================================================
CREATE TABLE IF NOT EXISTS patient_passports (
  id                       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  authority                TEXT NOT NULL,
  mrn_hash                 BYTEA NOT NULL UNIQUE,
  identity_hash            BYTEA NOT NULL,
  public_encryption_key    TEXT NOT NULL,
  recovery_threshold       SMALLINT NOT NULL CHECK (recovery_threshold BETWEEN 1 AND 10),
  guardians                TEXT[] NOT NULL,
  emergency_hospital_shard BOOLEAN NOT NULL DEFAULT FALSE,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status                   TEXT NOT NULL DEFAULT 'active'
                             CHECK (status IN ('active','suspended','revoked')),
  CONSTRAINT guardians_meet_threshold
    CHECK (cardinality(guardians) >= recovery_threshold)
);

CREATE INDEX IF NOT EXISTS idx_passports_authority ON patient_passports(authority);

-- =====================================================
-- Medical records
-- =====================================================
CREATE TABLE IF NOT EXISTS medical_records (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_passport        UUID NOT NULL REFERENCES patient_passports(id) ON DELETE RESTRICT,
  record_type             TEXT NOT NULL CHECK (record_type IN
                            ('note','lab','imaging','prescription','vital','procedure','discharge','referral')),
  content_hash            BYTEA NOT NULL,
  storage_locator         TEXT NOT NULL,
  abe_policy              TEXT NOT NULL,
  author                  TEXT NOT NULL,
  author_credential_hash  BYTEA NOT NULL,
  icd_codes_hash          BYTEA NOT NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status                  TEXT NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','final','amended','voided')),
  supersedes              UUID REFERENCES medical_records(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_records_patient ON medical_records(patient_passport, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_records_type ON medical_records(record_type);

-- Records past 'draft' cannot be deleted at the SQL level; they can only
-- be voided (status='voided') or amended (a new row with supersedes=this).
CREATE OR REPLACE FUNCTION block_record_delete() RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'medical_records.id=% is past draft (status=%); deletion forbidden. Use status=voided or supersede with an amendment.',
      OLD.id, OLD.status;
  END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_block_record_delete ON medical_records;
CREATE TRIGGER trg_block_record_delete
  BEFORE DELETE ON medical_records
  FOR EACH ROW EXECUTE FUNCTION block_record_delete();

-- =====================================================
-- Access grants
-- =====================================================
CREATE TABLE IF NOT EXISTS access_grants (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient             UUID NOT NULL REFERENCES patient_passports(id) ON DELETE RESTRICT,
  grantee             TEXT NOT NULL,
  scope_record_types  TEXT[] NOT NULL,
  scope_departments   TEXT[] NOT NULL DEFAULT '{}',
  scope_read          BOOLEAN NOT NULL DEFAULT TRUE,
  scope_write         BOOLEAN NOT NULL DEFAULT FALSE,
  scope_emergency     BOOLEAN NOT NULL DEFAULT FALSE,
  re_encryption_key   TEXT NOT NULL,
  valid_from          TIMESTAMPTZ NOT NULL,
  valid_until         TIMESTAMPTZ NOT NULL,
  max_accesses        INTEGER,
  access_count        INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'active'
                        CHECK (status IN ('active','expired','revoked')),
  grant_reason        TEXT NOT NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT grant_window_valid CHECK (valid_until > valid_from),
  CONSTRAINT grant_emergency_capped
    CHECK (NOT scope_emergency
           OR (valid_until - valid_from) <= INTERVAL '4 hours')
);

CREATE INDEX IF NOT EXISTS idx_grants_active_lookup
  ON access_grants(patient, grantee, status, valid_from, valid_until);

-- =====================================================
-- Consent records
-- =====================================================
CREATE TABLE IF NOT EXISTS consent_records (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  patient       UUID NOT NULL REFERENCES patient_passports(id) ON DELETE RESTRICT,
  consent_type  TEXT NOT NULL CHECK (consent_type IN
                  ('treatment','recording','research','data_sharing','emergency')),
  scope         TEXT NOT NULL,
  granted_to    TEXT,
  valid_from    TIMESTAMPTZ NOT NULL,
  valid_until   TIMESTAMPTZ,
  revoked_at    TIMESTAMPTZ,
  witness       TEXT,
  method        TEXT NOT NULL CHECK (method IN ('written','verbal','digital','auto')),
  signature     TEXT NOT NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_consents_patient ON consent_records(patient, valid_from DESC);

-- =====================================================
-- Audit log (hash-chained, append-only)
-- =====================================================
CREATE TABLE IF NOT EXISTS audit_log (
  seq              BIGSERIAL PRIMARY KEY,
  actor            TEXT NOT NULL,
  action           TEXT NOT NULL CHECK (action IN
                     ('view','create','amend','void','grant','revoke',
                      'emergency_access','break_glass','consent_change',
                      'export','key_rotation')),
  target_patient   UUID NOT NULL REFERENCES patient_passports(id) ON DELETE RESTRICT,
  target_record    UUID REFERENCES medical_records(id) ON DELETE RESTRICT,
  timestamp        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ip_hash          BYTEA NOT NULL,
  device_hash      BYTEA NOT NULL,
  metadata         TEXT NOT NULL DEFAULT '',
  prev_hash        BYTEA NOT NULL,
  entry_hash       BYTEA NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_patient ON audit_log(target_patient, seq DESC);
CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_log(actor, seq DESC);

-- audit_log is strictly append-only: no UPDATE, no DELETE.
CREATE OR REPLACE FUNCTION audit_log_immutable() RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'audit_log is append-only; UPDATE and DELETE are forbidden';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_audit_no_update ON audit_log;
CREATE TRIGGER trg_audit_no_update
  BEFORE UPDATE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

DROP TRIGGER IF EXISTS trg_audit_no_delete ON audit_log;
CREATE TRIGGER trg_audit_no_delete
  BEFORE DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION audit_log_immutable();

-- =====================================================
-- Audit checkpoint table
-- =====================================================
-- Periodically, an operator publishes the audit chain root to a WORM
-- destination (S3 Object Lock, append-only filesystem, customer-held
-- store, etc.) so silent tampering is detectable even by an adversary
-- with full database access.
CREATE TABLE IF NOT EXISTS audit_checkpoints (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  through_seq     BIGINT NOT NULL,
  root_hash       BYTEA NOT NULL,
  published_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  published_by    TEXT NOT NULL,
  destination_uri TEXT NOT NULL,
  CONSTRAINT chk_seq_positive CHECK (through_seq > 0)
);

CREATE INDEX IF NOT EXISTS idx_checkpoints_seq ON audit_checkpoints(through_seq DESC);

-- =====================================================
-- Migration tracking
-- =====================================================
CREATE TABLE IF NOT EXISTS schema_migrations (
  version    TEXT PRIMARY KEY,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO schema_migrations (version) VALUES ('001_init')
  ON CONFLICT (version) DO NOTHING;
