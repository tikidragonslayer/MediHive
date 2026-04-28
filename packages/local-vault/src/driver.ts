/**
 * MediHive — Copyright (C) 2024-2026 The MediHive Authors
 * Licensed under the GNU Affero General Public License v3.0 or later.
 *
 * LocalVaultDriver — Postgres-backed VaultDriver implementation.
 *
 * Threat model: this driver assumes a single-tenant Postgres database
 * controlled by the deploying hospital. Tampering by a database admin
 * is detectable via the audit chain checkpointed to WORM storage; it
 * is not prevented at the SQL layer (that is the on-chain profile's job).
 */

import { Pool, PoolClient, PoolConfig } from 'pg';
import {
  AccessGrant,
  AuditAction,
  AuditEntry,
  ConsentRecord,
  CreateAuditInput,
  CreateConsentInput,
  CreateGrantInput,
  CreatePassportInput,
  CreateRecordInput,
  DriverInfo,
  GrantStatus,
  Hash,
  Identity,
  MedicalRecord,
  PassportStatus,
  PatientPassport,
  RecordStatus,
  RecordType,
  VaultDriver,
} from '@medi-hive/vault-driver';
import {
  AuditPayload,
  ZERO_HASH,
  bufToHex,
  computeEntryHash,
  hexToBuf,
  verifyChain,
} from './audit-chain';

const DRIVER_VERSION = '0.1.0';

export interface LocalVaultDriverOptions {
  pool?: Pool;
  poolConfig?: PoolConfig;
  /** Override the backend label used in DriverInfo. */
  backendLabel?: string;
}

export class LocalVaultDriver implements VaultDriver {
  private readonly pool: Pool;
  private readonly backendLabel: string;

  constructor(opts: LocalVaultDriverOptions = {}) {
    if (opts.pool) {
      this.pool = opts.pool;
    } else if (opts.poolConfig) {
      this.pool = new Pool(opts.poolConfig);
    } else if (process.env.DATABASE_URL) {
      this.pool = new Pool({ connectionString: process.env.DATABASE_URL });
    } else {
      throw new Error(
        'LocalVaultDriver requires a Pool, poolConfig, or DATABASE_URL env var',
      );
    }
    this.backendLabel = opts.backendLabel ?? 'postgres';
  }

  info(): DriverInfo {
    return { kind: 'local', backend: this.backendLabel, version: DRIVER_VERSION };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  // ============================================================
  // Patient passports
  // ============================================================

  async createPassport(input: CreatePassportInput): Promise<PatientPassport> {
    const { rows } = await this.pool.query(
      `INSERT INTO patient_passports
         (authority, mrn_hash, identity_hash, public_encryption_key,
          recovery_threshold, guardians, emergency_hospital_shard)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        input.authority,
        hexToBuf(input.mrnHash),
        hexToBuf(input.identityHash),
        input.publicEncryptionKey,
        input.recoveryThreshold,
        input.guardians,
        input.emergencyHospitalShard,
      ],
    );
    return rowToPassport(rows[0]);
  }

  async getPassport(id: Identity): Promise<PatientPassport | null> {
    const { rows } = await this.pool.query('SELECT * FROM patient_passports WHERE id = $1', [id]);
    return rows[0] ? rowToPassport(rows[0]) : null;
  }

  async setPassportStatus(
    id: Identity,
    status: PassportStatus,
    actor: Identity,
  ): Promise<PatientPassport> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'UPDATE patient_passports SET status = $1 WHERE id = $2 RETURNING *',
        [status, id],
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        throw new Error(`patient_passport not found: ${id}`);
      }
      await this.appendAuditTx(client, {
        actor,
        action: status === PassportStatus.Revoked ? AuditAction.Revoke : AuditAction.ConsentChange,
        targetPatient: id,
        targetRecord: null,
        ipHash: '00'.repeat(32),
        deviceHash: '00'.repeat(32),
        metadata: `passport status -> ${status}`,
      });
      await client.query('COMMIT');
      return rowToPassport(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async rotatePassportEncryptionKey(
    id: Identity,
    newKey: string,
    actor: Identity,
  ): Promise<PatientPassport> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'UPDATE patient_passports SET public_encryption_key = $1 WHERE id = $2 RETURNING *',
        [newKey, id],
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        throw new Error(`patient_passport not found: ${id}`);
      }
      await this.appendAuditTx(client, {
        actor,
        action: AuditAction.KeyRotation,
        targetPatient: id,
        targetRecord: null,
        ipHash: '00'.repeat(32),
        deviceHash: '00'.repeat(32),
        metadata: 'passport encryption key rotated',
      });
      await client.query('COMMIT');
      return rowToPassport(rows[0]);
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ============================================================
  // Medical records
  // ============================================================

  async createRecord(input: CreateRecordInput): Promise<MedicalRecord> {
    const { rows } = await this.pool.query(
      `INSERT INTO medical_records
         (patient_passport, record_type, content_hash, storage_locator,
          abe_policy, author, author_credential_hash, icd_codes_hash, supersedes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        input.patientPassport,
        input.recordType,
        hexToBuf(input.contentHash),
        input.storageLocator,
        input.abePolicy,
        input.author,
        hexToBuf(input.authorCredentialHash),
        hexToBuf(input.icdCodesHash),
        input.supersedes ?? null,
      ],
    );
    return rowToRecord(rows[0]);
  }

  async getRecord(id: Identity): Promise<MedicalRecord | null> {
    const { rows } = await this.pool.query('SELECT * FROM medical_records WHERE id = $1', [id]);
    return rows[0] ? rowToRecord(rows[0]) : null;
  }

  async listRecordsForPatient(
    patient: Identity,
    options: { types?: RecordType[]; limit?: number; cursor?: string } = {},
  ): Promise<{ records: MedicalRecord[]; nextCursor: string | null }> {
    const limit = Math.min(options.limit ?? 50, 500);
    const cursorTs = options.cursor ? new Date(options.cursor) : null;
    const params: unknown[] = [patient];
    let where = 'patient_passport = $1';
    if (options.types && options.types.length > 0) {
      params.push(options.types);
      where += ` AND record_type = ANY($${params.length}::text[])`;
    }
    if (cursorTs) {
      params.push(cursorTs);
      where += ` AND created_at < $${params.length}`;
    }
    params.push(limit + 1);
    const { rows } = await this.pool.query(
      `SELECT * FROM medical_records
         WHERE ${where}
         ORDER BY created_at DESC
         LIMIT $${params.length}`,
      params,
    );
    const hasMore = rows.length > limit;
    const trimmed = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? new Date(trimmed[trimmed.length - 1].created_at).toISOString() : null;
    return { records: trimmed.map(rowToRecord), nextCursor };
  }

  async setRecordStatus(
    id: Identity,
    status: RecordStatus,
    actor: Identity,
  ): Promise<MedicalRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'UPDATE medical_records SET status = $1 WHERE id = $2 RETURNING *',
        [status, id],
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        throw new Error(`medical_record not found: ${id}`);
      }
      const record = rowToRecord(rows[0]);
      await this.appendAuditTx(client, {
        actor,
        action: status === RecordStatus.Voided ? AuditAction.Void : AuditAction.Amend,
        targetPatient: record.patientPassport,
        targetRecord: id,
        ipHash: '00'.repeat(32),
        deviceHash: '00'.repeat(32),
        metadata: `record status -> ${status}`,
      });
      await client.query('COMMIT');
      return record;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ============================================================
  // Access grants
  // ============================================================

  async createGrant(input: CreateGrantInput): Promise<AccessGrant> {
    const { rows } = await this.pool.query(
      `INSERT INTO access_grants
         (patient, grantee, scope_record_types, scope_departments,
          scope_read, scope_write, scope_emergency,
          re_encryption_key, valid_from, valid_until, max_accesses, grant_reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, to_timestamp($9), to_timestamp($10), $11, $12)
       RETURNING *`,
      [
        input.patient,
        input.grantee,
        input.scope.recordTypes,
        input.scope.departments,
        input.scope.read,
        input.scope.write,
        input.scope.emergency,
        input.reEncryptionKey,
        input.validFrom,
        input.validUntil,
        input.maxAccesses ?? null,
        input.grantReason,
      ],
    );
    return rowToGrant(rows[0]);
  }

  async getGrant(id: Identity): Promise<AccessGrant | null> {
    const { rows } = await this.pool.query('SELECT * FROM access_grants WHERE id = $1', [id]);
    return rows[0] ? rowToGrant(rows[0]) : null;
  }

  async findActiveGrant(
    patient: Identity,
    grantee: Identity,
    _forRecord?: Identity,
  ): Promise<AccessGrant | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM access_grants
         WHERE patient = $1
           AND grantee = $2
           AND status = 'active'
           AND valid_from <= NOW()
           AND valid_until > NOW()
           AND (max_accesses IS NULL OR access_count < max_accesses)
         ORDER BY valid_from DESC
         LIMIT 1`,
      [patient, grantee],
    );
    return rows[0] ? rowToGrant(rows[0]) : null;
  }

  async recordGrantAccess(id: Identity): Promise<AccessGrant> {
    const { rows } = await this.pool.query(
      `UPDATE access_grants
         SET access_count = access_count + 1
         WHERE id = $1 AND status = 'active'
         RETURNING *`,
      [id],
    );
    if (!rows[0]) throw new Error(`active grant not found: ${id}`);
    return rowToGrant(rows[0]);
  }

  async revokeGrant(id: Identity, actor: Identity): Promise<AccessGrant> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE access_grants SET status = 'revoked' WHERE id = $1 RETURNING *`,
        [id],
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        throw new Error(`grant not found: ${id}`);
      }
      const grant = rowToGrant(rows[0]);
      await this.appendAuditTx(client, {
        actor,
        action: AuditAction.Revoke,
        targetPatient: grant.patient,
        targetRecord: null,
        ipHash: '00'.repeat(32),
        deviceHash: '00'.repeat(32),
        metadata: `grant ${id} revoked`,
      });
      await client.query('COMMIT');
      return grant;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async expireGrants(_now: number): Promise<number> {
    const { rowCount } = await this.pool.query(
      `UPDATE access_grants
         SET status = 'expired'
         WHERE status = 'active' AND valid_until <= NOW()`,
    );
    return rowCount ?? 0;
  }

  // ============================================================
  // Consent
  // ============================================================

  async recordConsent(input: CreateConsentInput): Promise<ConsentRecord> {
    const { rows } = await this.pool.query(
      `INSERT INTO consent_records
         (patient, consent_type, scope, granted_to,
          valid_from, valid_until, witness, method, signature)
       VALUES ($1, $2, $3, $4, to_timestamp($5),
               CASE WHEN $6::bigint IS NULL THEN NULL ELSE to_timestamp($6) END,
               $7, $8, $9)
       RETURNING *`,
      [
        input.patient,
        input.consentType,
        input.scope,
        input.grantedTo ?? null,
        input.validFrom,
        input.validUntil ?? null,
        input.witness ?? null,
        input.method,
        input.signature,
      ],
    );
    return rowToConsent(rows[0]);
  }

  async getConsent(id: Identity): Promise<ConsentRecord | null> {
    const { rows } = await this.pool.query('SELECT * FROM consent_records WHERE id = $1', [id]);
    return rows[0] ? rowToConsent(rows[0]) : null;
  }

  async listConsentsForPatient(patient: Identity): Promise<ConsentRecord[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM consent_records WHERE patient = $1 ORDER BY valid_from DESC`,
      [patient],
    );
    return rows.map(rowToConsent);
  }

  async revokeConsent(id: Identity, actor: Identity, at: number): Promise<ConsentRecord> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE consent_records SET revoked_at = to_timestamp($1) WHERE id = $2 RETURNING *`,
        [at, id],
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        throw new Error(`consent not found: ${id}`);
      }
      const consent = rowToConsent(rows[0]);
      await this.appendAuditTx(client, {
        actor,
        action: AuditAction.ConsentChange,
        targetPatient: consent.patient,
        targetRecord: null,
        ipHash: '00'.repeat(32),
        deviceHash: '00'.repeat(32),
        metadata: `consent ${id} revoked`,
      });
      await client.query('COMMIT');
      return consent;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  // ============================================================
  // Audit (hash-chained, append-only)
  // ============================================================

  async appendAudit(input: CreateAuditInput): Promise<AuditEntry> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const entry = await this.appendAuditTx(client, input);
      await client.query('COMMIT');
      return entry;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  /**
   * Internal: must be called inside an open transaction so the chain
   * head read and the new row insert are atomic. We rely on a row-level
   * lock on the latest audit_log row to serialize concurrent appenders.
   */
  private async appendAuditTx(
    client: PoolClient,
    input: CreateAuditInput,
  ): Promise<AuditEntry> {
    // Lock the table briefly to serialize chain head reads. Fine for the
    // expected write rate (single-hospital deployment); if you need more
    // throughput, switch to a dedicated chain-head row with FOR UPDATE.
    await client.query('LOCK TABLE audit_log IN EXCLUSIVE MODE');

    const { rows: head } = await client.query(
      'SELECT entry_hash FROM audit_log ORDER BY seq DESC LIMIT 1',
    );
    const prevHash: Buffer = head[0] ? head[0].entry_hash : ZERO_HASH;

    const timestamp = Math.floor(Date.now() / 1000);
    const targetRecord = input.targetRecord ?? null;
    const payload: AuditPayload = {
      actor: input.actor,
      action: input.action,
      targetPatient: input.targetPatient,
      targetRecord,
      timestamp,
      ipHash: input.ipHash,
      deviceHash: input.deviceHash,
      metadata: input.metadata,
    };
    const entryHash = computeEntryHash(prevHash, payload);

    const { rows } = await client.query(
      `INSERT INTO audit_log
         (actor, action, target_patient, target_record, timestamp,
          ip_hash, device_hash, metadata, prev_hash, entry_hash)
       VALUES ($1, $2, $3, $4, to_timestamp($5), $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        input.actor,
        input.action,
        input.targetPatient,
        targetRecord,
        timestamp,
        hexToBuf(input.ipHash),
        hexToBuf(input.deviceHash),
        input.metadata,
        prevHash,
        entryHash,
      ],
    );
    return rowToAudit(rows[0]);
  }

  async getAuditEntry(seq: number): Promise<AuditEntry | null> {
    const { rows } = await this.pool.query('SELECT * FROM audit_log WHERE seq = $1', [seq]);
    return rows[0] ? rowToAudit(rows[0]) : null;
  }

  async verifyAuditChain(
    fromSeq: number,
    toSeq: number,
  ): Promise<{ entries: AuditEntry[]; rootHash: Hash; valid: boolean }> {
    const { rows } = await this.pool.query(
      'SELECT * FROM audit_log WHERE seq BETWEEN $1 AND $2 ORDER BY seq ASC',
      [fromSeq, toSeq],
    );
    const entries = rows.map(rowToAudit);
    const valid = verifyChain(
      rows.map((r) => ({
        prevHash: r.prev_hash,
        entryHash: r.entry_hash,
        payload: rowToAuditPayload(r),
      })),
    );
    const rootHash = entries.length === 0 ? bufToHex(ZERO_HASH) : entries[entries.length - 1].entryHash;
    return { entries, rootHash, valid };
  }

  async listAuditForPatient(
    patient: Identity,
    options: { since?: number; limit?: number } = {},
  ): Promise<AuditEntry[]> {
    const limit = Math.min(options.limit ?? 200, 1000);
    const params: unknown[] = [patient];
    let where = 'target_patient = $1';
    if (options.since != null) {
      params.push(new Date(options.since * 1000));
      where += ` AND timestamp >= $${params.length}`;
    }
    params.push(limit);
    const { rows } = await this.pool.query(
      `SELECT * FROM audit_log
         WHERE ${where}
         ORDER BY seq DESC
         LIMIT $${params.length}`,
      params,
    );
    return rows.map(rowToAudit);
  }
}

// ============================================================
// Row mappers
// ============================================================

interface PassportRow {
  id: string;
  authority: string;
  mrn_hash: Buffer;
  identity_hash: Buffer;
  public_encryption_key: string;
  recovery_threshold: number;
  guardians: string[];
  emergency_hospital_shard: boolean;
  created_at: Date;
  status: PassportStatus;
}

function rowToPassport(row: PassportRow): PatientPassport {
  return {
    id: row.id,
    authority: row.authority,
    mrnHash: bufToHex(row.mrn_hash),
    identityHash: bufToHex(row.identity_hash),
    publicEncryptionKey: row.public_encryption_key,
    recoveryThreshold: row.recovery_threshold,
    guardians: row.guardians,
    emergencyHospitalShard: row.emergency_hospital_shard,
    createdAt: Math.floor(row.created_at.getTime() / 1000),
    status: row.status,
  };
}

interface RecordRow {
  id: string;
  patient_passport: string;
  record_type: RecordType;
  content_hash: Buffer;
  storage_locator: string;
  abe_policy: string;
  author: string;
  author_credential_hash: Buffer;
  icd_codes_hash: Buffer;
  created_at: Date;
  status: RecordStatus;
  supersedes: string | null;
}

function rowToRecord(row: RecordRow): MedicalRecord {
  return {
    id: row.id,
    patientPassport: row.patient_passport,
    recordType: row.record_type,
    contentHash: bufToHex(row.content_hash),
    storageLocator: row.storage_locator,
    abePolicy: row.abe_policy,
    author: row.author,
    authorCredentialHash: bufToHex(row.author_credential_hash),
    icdCodesHash: bufToHex(row.icd_codes_hash),
    createdAt: Math.floor(row.created_at.getTime() / 1000),
    status: row.status,
    supersedes: row.supersedes,
  };
}

interface GrantRow {
  id: string;
  patient: string;
  grantee: string;
  scope_record_types: RecordType[];
  scope_departments: string[];
  scope_read: boolean;
  scope_write: boolean;
  scope_emergency: boolean;
  re_encryption_key: string;
  valid_from: Date;
  valid_until: Date;
  max_accesses: number | null;
  access_count: number;
  status: GrantStatus;
  grant_reason: string;
}

function rowToGrant(row: GrantRow): AccessGrant {
  return {
    id: row.id,
    patient: row.patient,
    grantee: row.grantee,
    scope: {
      recordTypes: row.scope_record_types,
      departments: row.scope_departments,
      read: row.scope_read,
      write: row.scope_write,
      emergency: row.scope_emergency,
    },
    reEncryptionKey: row.re_encryption_key,
    validFrom: Math.floor(row.valid_from.getTime() / 1000),
    validUntil: Math.floor(row.valid_until.getTime() / 1000),
    maxAccesses: row.max_accesses,
    accessCount: row.access_count,
    status: row.status,
    grantReason: row.grant_reason,
  };
}

interface ConsentRow {
  id: string;
  patient: string;
  consent_type: ConsentRecord['consentType'];
  scope: string;
  granted_to: string | null;
  valid_from: Date;
  valid_until: Date | null;
  revoked_at: Date | null;
  witness: string | null;
  method: ConsentRecord['method'];
  signature: string;
}

function rowToConsent(row: ConsentRow): ConsentRecord {
  return {
    id: row.id,
    patient: row.patient,
    consentType: row.consent_type,
    scope: row.scope,
    grantedTo: row.granted_to,
    validFrom: Math.floor(row.valid_from.getTime() / 1000),
    validUntil: row.valid_until ? Math.floor(row.valid_until.getTime() / 1000) : null,
    revokedAt: row.revoked_at ? Math.floor(row.revoked_at.getTime() / 1000) : null,
    witness: row.witness,
    method: row.method,
    signature: row.signature,
  };
}

interface AuditRow {
  seq: string | number;
  actor: string;
  action: AuditAction;
  target_patient: string;
  target_record: string | null;
  timestamp: Date;
  ip_hash: Buffer;
  device_hash: Buffer;
  metadata: string;
  prev_hash: Buffer;
  entry_hash: Buffer;
}

function rowToAudit(row: AuditRow): AuditEntry {
  return {
    seq: typeof row.seq === 'string' ? parseInt(row.seq, 10) : row.seq,
    actor: row.actor,
    action: row.action,
    targetPatient: row.target_patient,
    targetRecord: row.target_record,
    timestamp: Math.floor(row.timestamp.getTime() / 1000),
    ipHash: bufToHex(row.ip_hash),
    deviceHash: bufToHex(row.device_hash),
    metadata: row.metadata,
    entryHash: bufToHex(row.entry_hash),
    prevHash: bufToHex(row.prev_hash),
  };
}

function rowToAuditPayload(row: AuditRow): AuditPayload {
  return {
    actor: row.actor,
    action: row.action,
    targetPatient: row.target_patient,
    targetRecord: row.target_record,
    timestamp: Math.floor(row.timestamp.getTime() / 1000),
    ipHash: bufToHex(row.ip_hash),
    deviceHash: bufToHex(row.device_hash),
    metadata: row.metadata,
  };
}
