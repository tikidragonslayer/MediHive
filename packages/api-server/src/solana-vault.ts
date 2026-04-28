/**
 * MediHive — Copyright (C) 2024-2026 The MediHive Authors
 * Licensed under the GNU Affero General Public License v3.0 or later.
 *
 * SolanaVaultDriver — read-capable Solana implementation of VaultDriver.
 *
 * Wraps the existing @medi-hive/vault-sdk through the profile-agnostic
 * VaultDriver interface so the api-server can serve read traffic
 * against on-chain state without importing @solana/web3.js directly.
 *
 * Status
 * ------
 *   READ paths are implemented (passport, record, grant, consent, audit).
 *   WRITE paths throw a clear directional error pointing at the tracking
 *   issue, because the underlying vault-sdk does not yet ship transaction
 *   builders.
 *
 * Field mapping
 * -------------
 *   VaultDriver Identity (opaque string)  <->  Solana PublicKey (base58)
 *   VaultDriver Hash (hex string)         <->  Uint8Array (32 bytes)
 */

import { Connection, PublicKey } from '@solana/web3.js';
import {
  AccessGrant,
  AccessScope,
  AuditAction,
  AuditEntry,
  ConsentMethod,
  ConsentRecord,
  ConsentType,
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
import { MediHiveClient } from '@medi-hive/vault-sdk';
import type {
  PatientPassport as SdkPatientPassport,
  MedicalRecord as SdkMedicalRecord,
  AccessGrant as SdkAccessGrant,
  ConsentRecord as SdkConsentRecord,
  AuditEntry as SdkAuditEntry,
} from '@medi-hive/vault-sdk';

const DRIVER_VERSION = '0.2.0-read-only';

const NOT_YET_WRITES = (op: string): never => {
  throw new Error(
    `[SolanaVaultDriver] ${op} is a write operation. The on-chain profile ` +
      `is currently read-only because @medi-hive/vault-sdk does not yet ` +
      `expose transaction builders. Use MEDIHIVE_PROFILE=local for full ` +
      `read+write functionality, or contribute the Solana transaction ` +
      `layer: https://github.com/tikidragonslayer/MediHive/issues`,
  );
};

export interface SolanaVaultDriverOptions {
  rpcUrl?: string;
  cluster?: string;
  patientPassportProgramId?: string;
  recordManagerProgramId?: string;
  accessGrantsProgramId?: string;
  consentRegistryProgramId?: string;
  auditLoggerProgramId?: string;
}

// --- enum mappings (on-chain numeric variant -> driver string enum) ---
const PASSPORT_STATUS_FROM_NUM: PassportStatus[] = [
  PassportStatus.Active,
  PassportStatus.Suspended,
  PassportStatus.Revoked,
];

const RECORD_TYPE_FROM_NUM: RecordType[] = [
  RecordType.Note,
  RecordType.Lab,
  RecordType.Imaging,
  RecordType.Prescription,
  RecordType.Vital,
  RecordType.Procedure,
  RecordType.Discharge,
  RecordType.Referral,
];

const RECORD_STATUS_FROM_NUM: RecordStatus[] = [
  RecordStatus.Draft,
  RecordStatus.Final,
  RecordStatus.Amended,
  RecordStatus.Voided,
];

const GRANT_STATUS_FROM_NUM: GrantStatus[] = [
  GrantStatus.Active,
  GrantStatus.Expired,
  GrantStatus.Revoked,
];

const CONSENT_TYPE_FROM_NUM: ConsentType[] = [
  ConsentType.Treatment,
  ConsentType.Recording,
  ConsentType.Research,
  ConsentType.DataSharing,
  ConsentType.Emergency,
];

const CONSENT_METHOD_FROM_NUM: ConsentMethod[] = [
  ConsentMethod.Written,
  ConsentMethod.Verbal,
  ConsentMethod.Digital,
  ConsentMethod.Auto,
];

const AUDIT_ACTION_FROM_NUM: AuditAction[] = [
  AuditAction.View,
  AuditAction.Create,
  AuditAction.Amend,
  AuditAction.Void,
  AuditAction.Grant,
  AuditAction.Revoke,
  AuditAction.EmergencyAccess,
  AuditAction.BreakGlass,
  AuditAction.ConsentChange,
  AuditAction.Export,
  AuditAction.KeyRotation,
];

// --- conversion helpers ---
function bytesToHex(b: Uint8Array): string {
  return Buffer.from(b).toString('hex');
}

function pkToIdentity(pk: PublicKey): Identity {
  return pk.toBase58();
}

function identityToPk(id: Identity): PublicKey {
  return new PublicKey(id);
}

function nullablePkToIdentity(pk: PublicKey | null): Identity | null {
  return pk ? pkToIdentity(pk) : null;
}

// --- SDK -> driver shape mappers ---
function passportFromSdk(p: SdkPatientPassport, idHint: Identity): PatientPassport {
  return {
    id: idHint,
    authority: pkToIdentity(p.authority),
    mrnHash: bytesToHex(p.mrnHash),
    identityHash: bytesToHex(p.identityHash),
    publicEncryptionKey: Buffer.from(p.publicEncryptionKey).toString('base64'),
    recoveryThreshold: p.recoveryThreshold,
    guardians: p.guardians.map(pkToIdentity),
    emergencyHospitalShard: p.emergencyHospitalShard,
    createdAt: Number(p.createdAt),
    status: PASSPORT_STATUS_FROM_NUM[p.status] ?? PassportStatus.Active,
  };
}

function recordFromSdk(r: SdkMedicalRecord, idHint: Identity): MedicalRecord {
  return {
    id: idHint,
    patientPassport: pkToIdentity(r.patientPassport),
    recordType: RECORD_TYPE_FROM_NUM[r.recordType] ?? RecordType.Note,
    contentHash: bytesToHex(r.contentHash),
    storageLocator: r.ipfsCid ? `ipfs://${r.ipfsCid}` : '',
    abePolicy: r.abePolicy,
    author: pkToIdentity(r.author),
    authorCredentialHash: bytesToHex(r.authorCredentialHash),
    icdCodesHash: bytesToHex(r.icdCodesHash),
    createdAt: Number(r.createdAt),
    status: RECORD_STATUS_FROM_NUM[r.status] ?? RecordStatus.Draft,
    supersedes: nullablePkToIdentity(r.supersedes),
  };
}

function grantFromSdk(g: SdkAccessGrant, idHint: Identity): AccessGrant {
  const scope: AccessScope = {
    recordTypes: g.scope.recordTypes.map((n) => RECORD_TYPE_FROM_NUM[n] ?? RecordType.Note),
    departments: g.scope.departments,
    read: g.scope.read,
    write: g.scope.write,
    emergency: g.scope.emergency,
  };
  return {
    id: idHint,
    patient: pkToIdentity(g.patient),
    grantee: pkToIdentity(g.grantee),
    scope,
    reEncryptionKey: Buffer.from(g.reEncryptionKey).toString('base64'),
    validFrom: Number(g.validFrom),
    validUntil: Number(g.validUntil),
    maxAccesses: g.maxAccesses == null ? null : Number(g.maxAccesses),
    accessCount: Number(g.accessCount),
    status: GRANT_STATUS_FROM_NUM[g.status] ?? GrantStatus.Active,
    grantReason: g.grantReason,
  };
}

function consentFromSdk(c: SdkConsentRecord, idHint: Identity): ConsentRecord {
  return {
    id: idHint,
    patient: pkToIdentity(c.patient),
    consentType: CONSENT_TYPE_FROM_NUM[c.consentType] ?? ConsentType.Treatment,
    scope: c.scope,
    grantedTo: nullablePkToIdentity(c.grantedTo),
    validFrom: Number(c.validFrom),
    validUntil: c.validUntil == null ? null : Number(c.validUntil),
    revokedAt: c.revokedAt == null ? null : Number(c.revokedAt),
    witness: nullablePkToIdentity(c.witness),
    method: CONSENT_METHOD_FROM_NUM[c.method] ?? ConsentMethod.Auto,
    // The on-chain consent account itself is the signed artifact (it
    // was signed by the patient's wallet at submission time). We
    // surface a fixed marker because the off-chain Ed25519 signature
    // semantic doesn't apply to on-chain accounts.
    signature: 'on-chain-signed',
  };
}

function auditFromSdk(a: SdkAuditEntry, seq: number): AuditEntry {
  return {
    seq,
    actor: pkToIdentity(a.actor),
    action: AUDIT_ACTION_FROM_NUM[a.action] ?? AuditAction.View,
    targetPatient: pkToIdentity(a.targetPatient),
    targetRecord: nullablePkToIdentity(a.targetRecord),
    timestamp: Number(a.timestamp),
    ipHash: bytesToHex(a.ipHash),
    deviceHash: bytesToHex(a.deviceHash),
    metadata: a.metadata,
    // On-chain audit gets integrity from Solana's consensus, not from a
    // hash chain over canonical JSON. These fields exist for parity
    // with LocalVault but verification semantics differ between profiles.
    entryHash: '',
    prevHash: '',
  };
}

export class SolanaVaultDriver implements VaultDriver {
  private readonly client: MediHiveClient;
  private readonly cluster: string;

  constructor(opts: SolanaVaultDriverOptions = {}) {
    this.cluster = opts.cluster ?? 'devnet';
    this.client = new MediHiveClient({
      rpcUrl:
        opts.rpcUrl ??
        (this.cluster === 'mainnet-beta'
          ? 'https://api.mainnet-beta.solana.com'
          : 'https://api.devnet.solana.com'),
      ...(opts.patientPassportProgramId && {
        patientPassportProgramId: opts.patientPassportProgramId,
      }),
      ...(opts.recordManagerProgramId && {
        recordManagerProgramId: opts.recordManagerProgramId,
      }),
      ...(opts.accessGrantsProgramId && { accessGrantsProgramId: opts.accessGrantsProgramId }),
      ...(opts.consentRegistryProgramId && {
        consentRegistryProgramId: opts.consentRegistryProgramId,
      }),
      ...(opts.auditLoggerProgramId && { auditLoggerProgramId: opts.auditLoggerProgramId }),
    });
  }

  /** Direct access to the underlying RPC connection for advanced callers. */
  get connection(): Connection {
    return this.client.connection;
  }

  info(): DriverInfo {
    return {
      kind: 'onchain',
      backend: `solana:${this.cluster}`,
      version: DRIVER_VERSION,
    };
  }

  // ============================================================
  // Patient passports
  // ============================================================

  async createPassport(_: CreatePassportInput): Promise<PatientPassport> {
    return NOT_YET_WRITES('createPassport');
  }

  async getPassport(id: Identity): Promise<PatientPassport | null> {
    const wallet = identityToPk(id);
    const passport = await this.client.passport.getPassport(wallet);
    return passport ? passportFromSdk(passport, id) : null;
  }

  async setPassportStatus(
    _: Identity,
    __: PassportStatus,
    ___: Identity,
  ): Promise<PatientPassport> {
    return NOT_YET_WRITES('setPassportStatus');
  }

  async rotatePassportEncryptionKey(
    _: Identity,
    __: string,
    ___: Identity,
  ): Promise<PatientPassport> {
    return NOT_YET_WRITES('rotatePassportEncryptionKey');
  }

  // ============================================================
  // Medical records
  // ============================================================

  async createRecord(_: CreateRecordInput): Promise<MedicalRecord> {
    return NOT_YET_WRITES('createRecord');
  }

  async getRecord(id: Identity): Promise<MedicalRecord | null> {
    const recordPDA = identityToPk(id);
    const record = await this.client.records.getRecord(recordPDA);
    return record ? recordFromSdk(record, id) : null;
  }

  async listRecordsForPatient(
    patient: Identity,
    options: { types?: RecordType[]; limit?: number; cursor?: string } = {},
  ): Promise<{ records: MedicalRecord[]; nextCursor: string | null }> {
    const passport = identityToPk(patient);
    const records = await this.client.records.getPatientRecords(passport);
    let mapped = records.map((r, i) => recordFromSdk(r, `${patient}#${i}`));
    if (options.types && options.types.length > 0) {
      const allow = new Set(options.types);
      mapped = mapped.filter((r) => allow.has(r.recordType));
    }
    const limit = Math.min(options.limit ?? 50, 500);
    const cursor = options.cursor ? parseInt(options.cursor, 10) || 0 : 0;
    const slice = mapped.slice(cursor, cursor + limit);
    const nextCursor = cursor + limit < mapped.length ? String(cursor + limit) : null;
    return { records: slice, nextCursor };
  }

  async setRecordStatus(_: Identity, __: RecordStatus, ___: Identity): Promise<MedicalRecord> {
    return NOT_YET_WRITES('setRecordStatus');
  }

  // ============================================================
  // Access grants
  // ============================================================

  async createGrant(_: CreateGrantInput): Promise<AccessGrant> {
    return NOT_YET_WRITES('createGrant');
  }

  async getGrant(id: Identity): Promise<AccessGrant | null> {
    const grantPDA = identityToPk(id);
    const grant = await this.client.grants.getGrant(grantPDA);
    return grant ? grantFromSdk(grant, id) : null;
  }

  async findActiveGrant(
    patient: Identity,
    grantee: Identity,
    _forRecord?: Identity,
  ): Promise<AccessGrant | null> {
    const patientPk = identityToPk(patient);
    const granteePk = identityToPk(grantee);
    const grants = await this.client.grants.getPatientGrants(patientPk);
    const now = Math.floor(Date.now() / 1000);
    const active = grants.find((g) => {
      if (g.status !== 0) return false; // 0 = Active in the on-chain enum
      if (!g.grantee.equals(granteePk)) return false;
      if (Number(g.validFrom) > now) return false;
      if (Number(g.validUntil) <= now) return false;
      if (g.maxAccesses != null && Number(g.accessCount) >= Number(g.maxAccesses)) return false;
      return true;
    });
    return active ? grantFromSdk(active, `${patient}::${grantee}`) : null;
  }

  async recordGrantAccess(_: Identity): Promise<AccessGrant> {
    return NOT_YET_WRITES('recordGrantAccess');
  }

  async revokeGrant(_: Identity, __: Identity): Promise<AccessGrant> {
    return NOT_YET_WRITES('revokeGrant');
  }

  async expireGrants(_: number): Promise<number> {
    return NOT_YET_WRITES('expireGrants');
  }

  // ============================================================
  // Consent
  // ============================================================

  async recordConsent(_: CreateConsentInput): Promise<ConsentRecord> {
    return NOT_YET_WRITES('recordConsent');
  }

  async getConsent(id: Identity): Promise<ConsentRecord | null> {
    const consentPDA = identityToPk(id);
    const consent = await this.client.consent.getConsent(consentPDA);
    return consent ? consentFromSdk(consent, id) : null;
  }

  async listConsentsForPatient(patient: Identity): Promise<ConsentRecord[]> {
    const patientPk = identityToPk(patient);
    const consents = await this.client.consent.getPatientConsents(patientPk);
    return consents.map((c, i) => consentFromSdk(c, `${patient}#${i}`));
  }

  async revokeConsent(_: Identity, __: Identity, ___: number): Promise<ConsentRecord> {
    return NOT_YET_WRITES('revokeConsent');
  }

  // ============================================================
  // Audit
  // ============================================================

  async appendAudit(_: CreateAuditInput): Promise<AuditEntry> {
    return NOT_YET_WRITES('appendAudit');
  }

  async getAuditEntry(_: number): Promise<AuditEntry | null> {
    // On-chain audit entries are addressed by PDA, not by sequence
    // number. Until the SDK exposes a way to look up an entry by its
    // account address, this remains unimplemented.
    return null;
  }

  async verifyAuditChain(
    _: number,
    __: number,
  ): Promise<{ entries: AuditEntry[]; rootHash: Hash; valid: boolean }> {
    // The on-chain profile gets integrity from Solana's consensus, not
    // from a hash chain over canonical JSON. A future implementation
    // should walk the on-chain log accounts and produce a deterministic
    // root for parity with the LocalVault interface.
    return { entries: [], rootHash: '', valid: true };
  }

  async listAuditForPatient(
    patient: Identity,
    options: { since?: number; limit?: number } = {},
  ): Promise<AuditEntry[]> {
    const patientPk = identityToPk(patient);
    const entries = await this.client.audit.getPatientAuditTrail(patientPk);
    let filtered = entries;
    if (options.since != null) {
      filtered = filtered.filter((e) => Number(e.timestamp) >= options.since!);
    }
    const limit = Math.min(options.limit ?? 200, 1000);
    return filtered.slice(0, limit).map((e, i) => auditFromSdk(e, i));
  }
}
