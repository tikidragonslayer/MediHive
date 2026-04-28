/**
 * MediHive — Copyright (C) 2024-2026 The MediHive Authors
 * Licensed under the GNU Affero General Public License v3.0 or later.
 *
 * The VaultDriver interface. Both SolanaDriver and LocalDriver implement
 * this surface. The api-server depends on this interface only — it does
 * not import @solana/web3.js or pg directly. Profile selection happens
 * at process start via MEDIHIVE_PROFILE.
 */

import {
  AccessGrant,
  AccessScope,
  AuditAction,
  AuditEntry,
  ConsentMethod,
  ConsentRecord,
  ConsentType,
  DriverInfo,
  Hash,
  Identity,
  MedicalRecord,
  PassportStatus,
  PatientPassport,
  RecordStatus,
  RecordType,
} from './types';

// === Inputs (creation parameters, before the driver assigns IDs) ===

export interface CreatePassportInput {
  authority: Identity;
  mrnHash: Hash;
  identityHash: Hash;
  publicEncryptionKey: string;
  recoveryThreshold: number;
  guardians: Identity[];
  emergencyHospitalShard: boolean;
}

export interface CreateRecordInput {
  patientPassport: Identity;
  recordType: RecordType;
  contentHash: Hash;
  storageLocator: string;
  abePolicy: string;
  author: Identity;
  authorCredentialHash: Hash;
  icdCodesHash: Hash;
  supersedes?: Identity | null;
}

export interface CreateGrantInput {
  patient: Identity;
  grantee: Identity;
  scope: AccessScope;
  reEncryptionKey: string;
  validFrom: number;
  validUntil: number;
  maxAccesses?: number | null;
  grantReason: string;
}

export interface CreateConsentInput {
  patient: Identity;
  consentType: ConsentType;
  scope: string;
  grantedTo?: Identity | null;
  validFrom: number;
  validUntil?: number | null;
  witness?: Identity | null;
  method: ConsentMethod;
  /** Detached signature of the canonicalized payload, base64. */
  signature: string;
}

export interface CreateAuditInput {
  actor: Identity;
  action: AuditAction;
  targetPatient: Identity;
  targetRecord?: Identity | null;
  ipHash: Hash;
  deviceHash: Hash;
  metadata: string;
}

// === Driver interface ===

/**
 * The vault driver. Every method is async — the on-chain implementation
 * makes RPC calls; the local implementation hits Postgres.
 *
 * Drivers are responsible for assigning Identity values to newly created
 * objects. Callers MUST NOT depend on Identity format.
 */
export interface VaultDriver {
  info(): DriverInfo;

  // --- Patient passports ---
  createPassport(input: CreatePassportInput): Promise<PatientPassport>;
  getPassport(id: Identity): Promise<PatientPassport | null>;
  setPassportStatus(id: Identity, status: PassportStatus, actor: Identity): Promise<PatientPassport>;
  rotatePassportEncryptionKey(id: Identity, newKey: string, actor: Identity): Promise<PatientPassport>;

  // --- Medical records ---
  createRecord(input: CreateRecordInput): Promise<MedicalRecord>;
  getRecord(id: Identity): Promise<MedicalRecord | null>;
  listRecordsForPatient(
    patient: Identity,
    options?: { types?: RecordType[]; limit?: number; cursor?: string },
  ): Promise<{ records: MedicalRecord[]; nextCursor: string | null }>;
  setRecordStatus(id: Identity, status: RecordStatus, actor: Identity): Promise<MedicalRecord>;

  // --- Access grants ---
  createGrant(input: CreateGrantInput): Promise<AccessGrant>;
  getGrant(id: Identity): Promise<AccessGrant | null>;
  /**
   * Returns the active grant authorizing `grantee` to access `patient`'s
   * record (if any). Implementations MUST check status, time window, and
   * scope. Implementations MUST NOT auto-expire here — call expireGrants()
   * separately on a schedule.
   */
  findActiveGrant(
    patient: Identity,
    grantee: Identity,
    forRecord?: Identity,
  ): Promise<AccessGrant | null>;
  recordGrantAccess(id: Identity): Promise<AccessGrant>;
  revokeGrant(id: Identity, actor: Identity): Promise<AccessGrant>;
  expireGrants(now: number): Promise<number>;

  // --- Consent ---
  recordConsent(input: CreateConsentInput): Promise<ConsentRecord>;
  getConsent(id: Identity): Promise<ConsentRecord | null>;
  listConsentsForPatient(patient: Identity): Promise<ConsentRecord[]>;
  revokeConsent(id: Identity, actor: Identity, at: number): Promise<ConsentRecord>;

  // --- Audit (append-only, hash-chained) ---
  appendAudit(input: CreateAuditInput): Promise<AuditEntry>;
  getAuditEntry(seq: number): Promise<AuditEntry | null>;
  /**
   * Replays the audit chain from `fromSeq` to `toSeq` (inclusive), returns
   * entries and a final root hash. Tampering anywhere in the range produces
   * a different root. Verifiers compare this root against an externally
   * published checkpoint (e.g., daily WORM export).
   */
  verifyAuditChain(fromSeq: number, toSeq: number): Promise<{
    entries: AuditEntry[];
    rootHash: Hash;
    valid: boolean;
  }>;
  listAuditForPatient(
    patient: Identity,
    options?: { since?: number; limit?: number },
  ): Promise<AuditEntry[]>;
}
