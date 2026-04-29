-- MediHive — Copyright (C) 2024-2026 The MediHive Authors
-- Licensed under the GNU Affero General Public License v3.0 or later.
--
-- Patient bridge table: links a hospital's local patient passport to the
-- same patient's on-chain identity. Enables federated reads — a hospital
-- running the local profile can serve records the patient has stored on
-- their own on-chain passport, without the hospital itself running any
-- on-chain code.
--
-- Trust model:
--
--   1. The patient signs canonical(local_passport_id || onchain_passport_id
--      || nonce || timestamp) with their on-chain wallet private key.
--   2. The hospital verifies the signature against the on-chain wallet's
--      Ed25519 public key. If valid, the bridge is established.
--   3. Hospitals only WRITE to their local passport. The patient's
--      on-chain side is read-only from the hospital's perspective.
--   4. Patient controls onchain_record_types — which record types from
--      the on-chain side the hospital is allowed to read at all.
--
-- Threat surface:
--
--   - Forged signature: the on-chain pubkey is the source of truth. A
--     forgery requires breaking Ed25519 or stealing the patient's wallet.
--   - Replay: the nonce + timestamp must be unique per bridge insertion.
--     Hospital must reject signatures older than ~5 min.
--   - Swap attack (attacker links their wallet to your local passport):
--     the patient's local passport is identified by mrn_hash. A patient
--     with the matching MRN at the hospital is presumed legit. Frontdesk
--     UX should require ID check at the link moment regardless.

CREATE TABLE IF NOT EXISTS patient_bridges (
  -- The hospital's local UUID for this patient. May be NULL when a
  -- purely on-chain patient has not yet had a local record created.
  local_passport_id     UUID REFERENCES patient_passports(id) ON DELETE RESTRICT,

  -- The patient's on-chain wallet (base58 Solana pubkey). May be NULL
  -- when a purely-local patient has not yet generated an on-chain
  -- passport.
  onchain_passport_id   TEXT,

  -- How was the bridge established? Affects which fields are required.
  established_via       TEXT NOT NULL CHECK (established_via IN
                          ('patient_signed', 'admin_imported', 'fhir_match')),

  -- Detached Ed25519 signature, base64. Required when established_via
  -- = 'patient_signed'. Signed payload is canonical JSON of:
  --   {local_passport_id, onchain_passport_id, nonce, timestamp}
  -- (keys sorted lexicographically, RFC 8785 style).
  signature_b64         TEXT,

  -- Random nonce included in the signed payload — prevents replay of a
  -- previously-issued signature. Should be ≥128 bits of entropy.
  signature_nonce       TEXT,

  -- Unix epoch seconds at signature time. Hospital must reject if
  -- |now - signature_timestamp| > some threshold (default 300s).
  signature_timestamp   BIGINT,

  -- Per-bridge access policy. The patient declares which record types
  -- from their on-chain side the hospital is allowed to read. Empty
  -- array = on-chain reads disabled (bridge exists for identity proof
  -- only). The values match RecordType in @medi-hive/vault-driver.
  onchain_record_types  TEXT[] NOT NULL DEFAULT '{}',

  -- Was this bridge revoked? When set, federated reads must skip the
  -- on-chain side. Provides a path for the patient to disable a
  -- previous link without deleting the row (audit trail preservation).
  revoked_at            TIMESTAMPTZ,

  established_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Synthetic surrogate PK so we can have function-based uniqueness elsewhere.
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  CONSTRAINT bridge_at_least_one_id
    CHECK (local_passport_id IS NOT NULL OR onchain_passport_id IS NOT NULL),

  CONSTRAINT bridge_signature_required_when_signed
    CHECK (
      established_via <> 'patient_signed'
      OR (signature_b64 IS NOT NULL
          AND signature_nonce IS NOT NULL
          AND signature_timestamp IS NOT NULL)
    )
);

-- A given (local, onchain) pair can have at most one non-revoked row.
-- Function-based unique indexes work where PRIMARY KEY does not.
CREATE UNIQUE INDEX IF NOT EXISTS uq_bridges_pair_active
  ON patient_bridges (
    COALESCE(local_passport_id::text, ''),
    COALESCE(onchain_passport_id, '')
  )
  WHERE revoked_at IS NULL;

-- Lookup by local passport (the hot path: hospital has a local id, wants
-- to know whether this patient has an on-chain side).
CREATE INDEX IF NOT EXISTS idx_bridges_local
  ON patient_bridges(local_passport_id)
  WHERE local_passport_id IS NOT NULL AND revoked_at IS NULL;

-- Lookup by on-chain wallet (the inverse path: incoming on-chain
-- request, find the corresponding local passport).
CREATE INDEX IF NOT EXISTS idx_bridges_onchain
  ON patient_bridges(onchain_passport_id)
  WHERE onchain_passport_id IS NOT NULL AND revoked_at IS NULL;

INSERT INTO schema_migrations (version) VALUES ('002_bridges')
  ON CONFLICT (version) DO NOTHING;
