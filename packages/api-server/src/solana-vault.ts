/**
 * MediHive — Copyright (C) 2024-2026 The MediHive Authors
 * Licensed under the GNU Affero General Public License v3.0 or later.
 *
 * SolanaVaultDriver — onchain-profile placeholder.
 *
 * This file establishes the class so the profile factory can return a
 * driver for MEDIHIVE_PROFILE=onchain without depending on @medi-hive/local-vault.
 * The full Solana implementation (wrapping the Anchor programs in
 * @medi-hive/vault-sdk) lands in a follow-up PR. Calling any driver
 * method here today throws a clear error directing operators to use the
 * local profile or contribute the implementation.
 *
 * Why ship a stub: keeps the api-server's dependency graph clean of
 * direct @solana/web3.js usage and lets `MEDIHIVE_PROFILE` be a real
 * runtime switch from day one.
 */

import {
  AccessGrant,
  AuditEntry,
  ConsentRecord,
  CreateAuditInput,
  CreateConsentInput,
  CreateGrantInput,
  CreatePassportInput,
  CreateRecordInput,
  DriverInfo,
  Hash,
  Identity,
  MedicalRecord,
  PassportStatus,
  PatientPassport,
  RecordStatus,
  RecordType,
  VaultDriver,
} from '@medi-hive/vault-driver';

const NOT_YET = (op: string): never => {
  throw new Error(
    `[SolanaVaultDriver] ${op} is not yet implemented through the VaultDriver interface. ` +
      `The on-chain profile is a work in progress; use MEDIHIVE_PROFILE=local for full functionality, ` +
      `or contribute the Solana driver: see https://github.com/tikidragonslayer/MediHive/issues`,
  );
};

export interface SolanaVaultDriverOptions {
  cluster?: string;
  programId?: string;
}

export class SolanaVaultDriver implements VaultDriver {
  private readonly cluster: string;

  constructor(opts: SolanaVaultDriverOptions = {}) {
    this.cluster = opts.cluster ?? 'devnet';
  }

  info(): DriverInfo {
    return {
      kind: 'onchain',
      backend: `solana:${this.cluster}`,
      version: '0.1.0-stub',
    };
  }

  // --- Patient passports ---
  createPassport(_: CreatePassportInput): Promise<PatientPassport> {
    NOT_YET('createPassport');
  }
  getPassport(_: Identity): Promise<PatientPassport | null> {
    NOT_YET('getPassport');
  }
  setPassportStatus(_: Identity, __: PassportStatus, ___: Identity): Promise<PatientPassport> {
    NOT_YET('setPassportStatus');
  }
  rotatePassportEncryptionKey(_: Identity, __: string, ___: Identity): Promise<PatientPassport> {
    NOT_YET('rotatePassportEncryptionKey');
  }

  // --- Medical records ---
  createRecord(_: CreateRecordInput): Promise<MedicalRecord> {
    NOT_YET('createRecord');
  }
  getRecord(_: Identity): Promise<MedicalRecord | null> {
    NOT_YET('getRecord');
  }
  listRecordsForPatient(
    _: Identity,
    __?: { types?: RecordType[]; limit?: number; cursor?: string },
  ): Promise<{ records: MedicalRecord[]; nextCursor: string | null }> {
    NOT_YET('listRecordsForPatient');
  }
  setRecordStatus(_: Identity, __: RecordStatus, ___: Identity): Promise<MedicalRecord> {
    NOT_YET('setRecordStatus');
  }

  // --- Access grants ---
  createGrant(_: CreateGrantInput): Promise<AccessGrant> {
    NOT_YET('createGrant');
  }
  getGrant(_: Identity): Promise<AccessGrant | null> {
    NOT_YET('getGrant');
  }
  findActiveGrant(_: Identity, __: Identity, ___?: Identity): Promise<AccessGrant | null> {
    NOT_YET('findActiveGrant');
  }
  recordGrantAccess(_: Identity): Promise<AccessGrant> {
    NOT_YET('recordGrantAccess');
  }
  revokeGrant(_: Identity, __: Identity): Promise<AccessGrant> {
    NOT_YET('revokeGrant');
  }
  expireGrants(_: number): Promise<number> {
    NOT_YET('expireGrants');
  }

  // --- Consent ---
  recordConsent(_: CreateConsentInput): Promise<ConsentRecord> {
    NOT_YET('recordConsent');
  }
  getConsent(_: Identity): Promise<ConsentRecord | null> {
    NOT_YET('getConsent');
  }
  listConsentsForPatient(_: Identity): Promise<ConsentRecord[]> {
    NOT_YET('listConsentsForPatient');
  }
  revokeConsent(_: Identity, __: Identity, ___: number): Promise<ConsentRecord> {
    NOT_YET('revokeConsent');
  }

  // --- Audit ---
  appendAudit(_: CreateAuditInput): Promise<AuditEntry> {
    NOT_YET('appendAudit');
  }
  getAuditEntry(_: number): Promise<AuditEntry | null> {
    NOT_YET('getAuditEntry');
  }
  verifyAuditChain(
    _: number,
    __: number,
  ): Promise<{ entries: AuditEntry[]; rootHash: Hash; valid: boolean }> {
    NOT_YET('verifyAuditChain');
  }
  listAuditForPatient(
    _: Identity,
    __?: { since?: number; limit?: number },
  ): Promise<AuditEntry[]> {
    NOT_YET('listAuditForPatient');
  }
}
