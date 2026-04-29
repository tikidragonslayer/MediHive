/**
 * MediHive — Copyright (C) 2024-2026 The MediHive Authors
 * Licensed under the GNU Affero General Public License v3.0 or later.
 *
 * FederatedVaultDriver — wraps a LocalVaultDriver (the hospital's own
 * Postgres-backed records) and a read-only on-chain VaultDriver (the
 * patient's sovereign records on Solana). Reads merge across both;
 * writes go to the local side only.
 *
 * Federation lookup uses PatientBridgeStore: every Identity from the
 * hospital's API perspective is a local passport UUID. The store maps
 * that to the corresponding on-chain wallet (if any) so the federated
 * driver knows whether to query the on-chain side at all.
 *
 * Trust model:
 *   - Hospital's local Postgres is authoritative for hospital records.
 *   - Patient's on-chain side is authoritative for patient-curated
 *     records (e.g. records the patient stamped from another hospital).
 *   - Bridges are established via patient-signed Ed25519 over canonical
 *     JSON. Hospital admin establishes the link interactively at the
 *     front desk.
 *   - Hospital can never WRITE to the on-chain side. The patient owns
 *     their wallet's private key; only the patient can write.
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
import { PatientBridgeStore } from './bridge-store';

const DRIVER_VERSION = '0.1.0-federation';

export interface FederatedVaultDriverOptions {
  local: VaultDriver;
  onchain: VaultDriver;
  bridgeStore: PatientBridgeStore;
  /** Optional metadata override. Useful for tests. */
  backendLabel?: string;
}

export class FederatedVaultDriver implements VaultDriver {
  private readonly local: VaultDriver;
  private readonly onchain: VaultDriver;
  private readonly bridges: PatientBridgeStore;
  private readonly backendLabel: string;

  constructor(opts: FederatedVaultDriverOptions) {
    this.local = opts.local;
    this.onchain = opts.onchain;
    this.bridges = opts.bridgeStore;
    this.backendLabel = opts.backendLabel ?? 'postgres+solana';
  }

  info(): DriverInfo {
    const local = this.local.info();
    const onchain = this.onchain.info();
    return {
      kind: 'local', // federated profile is fundamentally local-side; on-chain is read-augmentation
      backend: `federated(${local.backend}, ${onchain.backend})`,
      version: `${DRIVER_VERSION} [local=${local.version}, onchain=${onchain.version}]`,
    };
  }

  // ============================================================
  // Patient passports — local is authoritative
  // ============================================================

  async createPassport(input: CreatePassportInput): Promise<PatientPassport> {
    return this.local.createPassport(input);
  }

  async getPassport(id: Identity): Promise<PatientPassport | null> {
    return this.local.getPassport(id);
  }

  async setPassportStatus(id: Identity, status: PassportStatus, actor: Identity) {
    return this.local.setPassportStatus(id, status, actor);
  }

  async rotatePassportEncryptionKey(id: Identity, newKey: string, actor: Identity) {
    return this.local.rotatePassportEncryptionKey(id, newKey, actor);
  }

  // ============================================================
  // Medical records — federation reads, local writes
  // ============================================================

  async createRecord(input: CreateRecordInput): Promise<MedicalRecord> {
    // Hospitals only write to their own local store. The patient's
    // on-chain side is read-only from the hospital's perspective.
    return this.local.createRecord(input);
  }

  async getRecord(id: Identity): Promise<MedicalRecord | null> {
    // We don't know whether `id` is a local UUID or an on-chain PDA.
    // Try local first (the common case for hospital workflows), then
    // on-chain if local has no match.
    const local = await this.local.getRecord(id).catch(() => null);
    if (local) return local;
    return this.onchain.getRecord(id).catch(() => null);
  }

  async listRecordsForPatient(
    patient: Identity,
    options: { types?: RecordType[]; limit?: number; cursor?: string } = {},
  ): Promise<{ records: MedicalRecord[]; nextCursor: string | null }> {
    const bridge = await this.bridges.findByLocal(patient);

    // Always pull local. listRecordsForPatient on the local driver is
    // exhaustive within its own dataset.
    const localResult = await this.local.listRecordsForPatient(patient, options);

    // On-chain side: only if patient has an active bridge AND opted in
    // record types. Empty array means "bridge is identity-proof only,
    // do not read on-chain records here."
    if (
      !bridge ||
      !bridge.onchainPassportId ||
      bridge.onchainRecordTypes.length === 0
    ) {
      return localResult;
    }

    // Filter on-chain reads through the patient's allowlist.
    const allowedTypes = bridge.onchainRecordTypes as RecordType[];
    const requestedTypes = options.types
      ? options.types.filter((t) => allowedTypes.includes(t))
      : allowedTypes;

    if (requestedTypes.length === 0) {
      // Patient explicitly didn't authorize any of the requested types.
      return localResult;
    }

    let onchainRecords: MedicalRecord[] = [];
    try {
      const onchainResult = await this.onchain.listRecordsForPatient(bridge.onchainPassportId, {
        ...options,
        types: requestedTypes,
      });
      onchainRecords = onchainResult.records;
    } catch {
      // On-chain RPC failures must not break hospital reads. The
      // hospital's clinical workflow continues with local-only records.
      // Log/metric this in production; for now we swallow.
    }

    // Tag on-chain records with their origin so the dashboard can
    // distinguish "we have this in our chart" from "patient brought
    // this from another provider."
    const taggedOnchain = onchainRecords.map((r) => ({
      ...r,
      // Repurpose abePolicy as a transport for source-tagging until
      // we add a first-class field. Consumers that don't care can
      // ignore it; consumers that do can split on the colon.
      abePolicy: `source:onchain;${r.abePolicy}`,
    }));

    const merged = [...localResult.records, ...taggedOnchain].sort(
      (a, b) => b.createdAt - a.createdAt,
    );

    // Apply limit AFTER merge so on-chain records aren't truncated by
    // local pagination.
    const limit = options.limit ?? 50;
    const sliced = merged.slice(0, limit);

    return {
      records: sliced,
      // Next-cursor semantics for federated reads is genuinely tricky
      // (you'd need a cursor encoding "local cursor + onchain cursor"
      // separately). For v1 we punt: callers that need pagination
      // should use type-narrowed queries against either side directly.
      nextCursor: merged.length > limit ? 'federation-cursor-not-yet-supported' : null,
    };
  }

  async setRecordStatus(id: Identity, status: RecordStatus, actor: Identity) {
    return this.local.setRecordStatus(id, status, actor);
  }

  // ============================================================
  // Access grants — local writes only
  // ============================================================

  async createGrant(input: CreateGrantInput): Promise<AccessGrant> {
    return this.local.createGrant(input);
  }

  async getGrant(id: Identity): Promise<AccessGrant | null> {
    return this.local.getGrant(id);
  }

  async findActiveGrant(
    patient: Identity,
    grantee: Identity,
    forRecord?: Identity,
  ): Promise<AccessGrant | null> {
    return this.local.findActiveGrant(patient, grantee, forRecord);
  }

  async recordGrantAccess(id: Identity): Promise<AccessGrant> {
    return this.local.recordGrantAccess(id);
  }

  async revokeGrant(id: Identity, actor: Identity): Promise<AccessGrant> {
    return this.local.revokeGrant(id, actor);
  }

  async expireGrants(now: number): Promise<number> {
    return this.local.expireGrants(now);
  }

  // ============================================================
  // Consent — local writes; on-chain is authoritative for patient-side
  // consent revocations the hospital must honour
  // ============================================================

  async recordConsent(input: CreateConsentInput): Promise<ConsentRecord> {
    return this.local.recordConsent(input);
  }

  async getConsent(id: Identity): Promise<ConsentRecord | null> {
    return this.local.getConsent(id);
  }

  async listConsentsForPatient(patient: Identity): Promise<ConsentRecord[]> {
    const bridge = await this.bridges.findByLocal(patient);
    const localConsents = await this.local.listConsentsForPatient(patient);

    if (!bridge || !bridge.onchainPassportId) return localConsents;

    let onchainConsents: ConsentRecord[] = [];
    try {
      onchainConsents = await this.onchain.listConsentsForPatient(bridge.onchainPassportId);
    } catch {
      /* on-chain unavailable; return what we have */
    }

    return [...localConsents, ...onchainConsents].sort((a, b) => b.validFrom - a.validFrom);
  }

  async revokeConsent(id: Identity, actor: Identity, at: number): Promise<ConsentRecord> {
    return this.local.revokeConsent(id, actor, at);
  }

  // ============================================================
  // Audit — local writes; reads merge for the patient-facing view
  // ============================================================

  async appendAudit(input: CreateAuditInput): Promise<AuditEntry> {
    return this.local.appendAudit(input);
  }

  async getAuditEntry(seq: number): Promise<AuditEntry | null> {
    return this.local.getAuditEntry(seq);
  }

  async verifyAuditChain(
    fromSeq: number,
    toSeq: number,
  ): Promise<{ entries: AuditEntry[]; rootHash: Hash; valid: boolean }> {
    // Verifying integrity is a local-side concern; on-chain audits
    // get integrity from consensus, not a hash chain.
    return this.local.verifyAuditChain(fromSeq, toSeq);
  }

  async listAuditForPatient(
    patient: Identity,
    options: { since?: number; limit?: number } = {},
  ): Promise<AuditEntry[]> {
    const bridge = await this.bridges.findByLocal(patient);
    const local = await this.local.listAuditForPatient(patient, options);

    if (!bridge || !bridge.onchainPassportId) return local;

    let onchain: AuditEntry[] = [];
    try {
      onchain = await this.onchain.listAuditForPatient(bridge.onchainPassportId, options);
    } catch {
      /* on-chain unavailable */
    }

    return [...local, ...onchain].sort((a, b) => b.timestamp - a.timestamp);
  }
}
