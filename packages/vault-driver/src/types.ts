/**
 * MediHive — Copyright (C) 2024-2026 The MediHive Authors
 * Licensed under the GNU Affero General Public License v3.0 or later.
 *
 * Profile-agnostic types for the vault driver interface.
 * The same shapes are used whether the underlying driver is Solana
 * (on-chain) or Local (Postgres-backed).
 */

/**
 * Opaque identity. For SolanaDriver this is a base58 PublicKey string.
 * For LocalDriver this is a UUIDv7 (or similar). Drivers MUST treat
 * Identity as opaque; the API surface never inspects its shape.
 */
export type Identity = string;

/**
 * SHA-256 hash, 32 bytes, hex-encoded for transport. (Buffers in
 * memory; strings on the wire so JSON serialization is lossless.)
 */
export type Hash = string;

// === Patient Passport ===

export enum PassportStatus {
  Active = 'active',
  Suspended = 'suspended',
  Revoked = 'revoked',
}

export interface PatientPassport {
  id: Identity;
  authority: Identity;
  mrnHash: Hash;
  identityHash: Hash;
  publicEncryptionKey: string; // base64
  recoveryThreshold: number;
  guardians: Identity[];
  emergencyHospitalShard: boolean;
  createdAt: number;
  status: PassportStatus;
}

// === Medical Records ===

export enum RecordType {
  Note = 'note',
  Lab = 'lab',
  Imaging = 'imaging',
  Prescription = 'prescription',
  Vital = 'vital',
  Procedure = 'procedure',
  Discharge = 'discharge',
  Referral = 'referral',
}

export enum RecordStatus {
  Draft = 'draft',
  Final = 'final',
  Amended = 'amended',
  Voided = 'voided',
}

export interface MedicalRecord {
  id: Identity;
  patientPassport: Identity;
  recordType: RecordType;
  contentHash: Hash;
  storageLocator: string; // ipfs://CID for onchain, file:// or s3:// for local
  abePolicy: string;
  author: Identity;
  authorCredentialHash: Hash;
  icdCodesHash: Hash;
  createdAt: number;
  status: RecordStatus;
  supersedes: Identity | null;
}

// === Access Grants ===

export enum GrantStatus {
  Active = 'active',
  Expired = 'expired',
  Revoked = 'revoked',
}

export interface AccessScope {
  recordTypes: RecordType[];
  departments: string[];
  read: boolean;
  write: boolean;
  emergency: boolean;
}

export interface AccessGrant {
  id: Identity;
  patient: Identity;
  grantee: Identity;
  scope: AccessScope;
  reEncryptionKey: string; // base64; opaque to the driver
  validFrom: number;
  validUntil: number;
  maxAccesses: number | null;
  accessCount: number;
  status: GrantStatus;
  grantReason: string;
}

// === Consent ===

export enum ConsentType {
  Treatment = 'treatment',
  Recording = 'recording',
  Research = 'research',
  DataSharing = 'data_sharing',
  Emergency = 'emergency',
}

export enum ConsentMethod {
  Written = 'written',
  Verbal = 'verbal',
  Digital = 'digital',
  Auto = 'auto',
}

export interface ConsentRecord {
  id: Identity;
  patient: Identity;
  consentType: ConsentType;
  scope: string;
  grantedTo: Identity | null;
  validFrom: number;
  validUntil: number | null;
  revokedAt: number | null;
  witness: Identity | null;
  method: ConsentMethod;
  /** Detached Ed25519 signature of canonicalized consent JSON, base64. */
  signature: string;
}

// === Audit ===

export enum AuditAction {
  View = 'view',
  Create = 'create',
  Amend = 'amend',
  Void = 'void',
  Grant = 'grant',
  Revoke = 'revoke',
  EmergencyAccess = 'emergency_access',
  BreakGlass = 'break_glass',
  ConsentChange = 'consent_change',
  Export = 'export',
  KeyRotation = 'key_rotation',
}

export interface AuditEntry {
  /** Monotonic sequence number within the audit chain. */
  seq: number;
  actor: Identity;
  action: AuditAction;
  targetPatient: Identity;
  targetRecord: Identity | null;
  timestamp: number;
  ipHash: Hash;
  deviceHash: Hash;
  metadata: string;
  /**
   * SHA-256(prevHash || canonicalized(payload)). The first entry chains
   * from the all-zero hash. Verifiers replay the chain and compare against
   * the latest published checkpoint.
   */
  entryHash: Hash;
  prevHash: Hash;
}

// === Driver metadata ===

export type ProfileKind = 'onchain' | 'local';

export interface DriverInfo {
  kind: ProfileKind;
  /** Human-readable backend description, e.g. "solana:devnet" or "postgres:medihive". */
  backend: string;
  /** Build/version string of the driver implementation. */
  version: string;
}
