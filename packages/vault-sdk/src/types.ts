import { PublicKey } from '@solana/web3.js';

// === Patient Passport Types ===

export enum PassportStatus {
  Active = 0,
  Suspended = 1,
  Revoked = 2,
}

export interface PatientPassport {
  authority: PublicKey;
  mrnHash: Uint8Array;
  identityHash: Uint8Array;
  publicEncryptionKey: Uint8Array;
  recoveryThreshold: number;
  guardians: PublicKey[];
  emergencyHospitalShard: boolean;
  createdAt: number;
  status: PassportStatus;
  bump: number;
}

// === Medical Record Types ===

export enum RecordType {
  Note = 0,
  Lab = 1,
  Imaging = 2,
  Prescription = 3,
  Vital = 4,
  Procedure = 5,
  Discharge = 6,
  Referral = 7,
}

export enum RecordStatus {
  Draft = 0,
  Final = 1,
  Amended = 2,
  Voided = 3,
}

export interface MedicalRecord {
  patientPassport: PublicKey;
  recordType: RecordType;
  contentHash: Uint8Array;
  ipfsCid: string;
  arweaveTx: string | null;
  abePolicy: string;
  author: PublicKey;
  authorCredentialHash: Uint8Array;
  icdCodesHash: Uint8Array;
  createdAt: number;
  status: RecordStatus;
  supersedes: PublicKey | null;
  bump: number;
}

// === Access Grant Types ===

export enum GrantStatus {
  Active = 0,
  Expired = 1,
  Revoked = 2,
}

export interface AccessScope {
  recordTypes: number[];
  departments: string[];
  read: boolean;
  write: boolean;
  emergency: boolean;
}

export interface AccessGrant {
  patient: PublicKey;
  grantee: PublicKey;
  scope: AccessScope;
  reEncryptionKey: Uint8Array;
  validFrom: number;
  validUntil: number;
  maxAccesses: number | null;
  accessCount: number;
  status: GrantStatus;
  grantReason: string;
  nonce: number;
  bump: number;
}

// === Consent Types ===

export enum ConsentType {
  Treatment = 0,
  Recording = 1,
  Research = 2,
  DataSharing = 3,
  Emergency = 4,
}

export enum ConsentMethod {
  Written = 0,
  Verbal = 1,
  Digital = 2,
  Auto = 3,
}

export interface ConsentRecord {
  patient: PublicKey;
  consentType: ConsentType;
  scope: string;
  grantedTo: PublicKey | null;
  validFrom: number;
  validUntil: number | null;
  revokedAt: number | null;
  witness: PublicKey | null;
  method: ConsentMethod;
  nonce: number;
  bump: number;
}

// === Audit Types ===

export enum AuditAction {
  View = 0,
  Create = 1,
  Amend = 2,
  Void = 3,
  Grant = 4,
  Revoke = 5,
  EmergencyAccess = 6,
  BreakGlass = 7,
  ConsentChange = 8,
  Export = 9,
  KeyRotation = 10,
}

export interface AuditEntry {
  actor: PublicKey;
  action: AuditAction;
  targetPatient: PublicKey;
  targetRecord: PublicKey | null;
  timestamp: number;
  ipHash: Uint8Array;
  deviceHash: Uint8Array;
  metadata: string;
  bump: number;
}

// === FHIR Types (simplified for SDK) ===

export interface FHIRBundle {
  resourceType: 'Bundle';
  type: 'collection';
  entry: FHIREntry[];
}

export interface FHIREntry {
  resource: {
    resourceType: string;
    [key: string]: unknown;
  };
}

// === Encryption Types ===

export interface EncryptedRecord {
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  ipfsCid: string;
  contentHash: Uint8Array;
}

export interface PatientKeyPair {
  signingKey: Uint8Array;
  encryptionKey: Uint8Array;
  recoveryKey: Uint8Array;
  delegationKey: Uint8Array;
}
