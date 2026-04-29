/**
 * MediHive — Copyright (C) 2024-2026 The MediHive Authors
 * Licensed under the GNU Affero General Public License v3.0 or later.
 *
 * Integration tests for the federation layer:
 *   - PatientBridgeStore (Postgres-backed)
 *   - Ed25519BridgeVerifier (Node crypto over canonical payload)
 *   - FederatedVaultDriver (merges local Postgres + mock on-chain)
 *
 * Skipped if DATABASE_URL is unset.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { generateKeyPairSync, sign as cryptoSign } from 'crypto';
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
import { LocalVaultDriver } from '../driver';
import {
  PatientBridgeStore,
  BridgeSignatureVerifier,
} from '../bridge-store';
import { canonicalizeBridge, BridgePayload } from '../bridge-canonical';
import { Ed25519BridgeVerifier } from '../ed25519-verifier';
import { FederatedVaultDriver } from '../federated-driver';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const make32Hex = (seed: number): string =>
  Buffer.from(Array.from({ length: 32 }, (_, i) => (seed + i) & 0xff)).toString('hex');

const randHex32 = (): string => {
  const b = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) b[i] = Math.floor(Math.random() * 256);
  return b.toString('hex');
};

const nowSec = () => Math.floor(Date.now() / 1000);

// Test verifier that accepts everything — used for non-crypto path tests.
class AcceptAllVerifier implements BridgeSignatureVerifier {
  verify(): boolean {
    return true;
  }
}

class RejectAllVerifier implements BridgeSignatureVerifier {
  verify(): boolean {
    return false;
  }
}

/**
 * Mock on-chain VaultDriver — in-memory, returns whatever you seed it
 * with via `seed()`. We don't need a real Solana RPC to test the
 * federation merge logic.
 */
class MockOnchainDriver implements VaultDriver {
  private records: Map<string, MedicalRecord[]> = new Map();
  private consents: Map<string, ConsentRecord[]> = new Map();
  private audit: Map<string, AuditEntry[]> = new Map();

  seed(walletPubkey: string, opts: {
    records?: MedicalRecord[];
    consents?: ConsentRecord[];
    audit?: AuditEntry[];
  }) {
    if (opts.records) this.records.set(walletPubkey, opts.records);
    if (opts.consents) this.consents.set(walletPubkey, opts.consents);
    if (opts.audit) this.audit.set(walletPubkey, opts.audit);
  }

  info(): DriverInfo {
    return { kind: 'onchain', backend: 'mock', version: 'test' };
  }

  async createPassport(_: CreatePassportInput): Promise<PatientPassport> {
    throw new Error('mock');
  }
  async getPassport(_: Identity): Promise<PatientPassport | null> {
    return null;
  }
  async setPassportStatus(_: Identity, __: PassportStatus, ___: Identity): Promise<PatientPassport> {
    throw new Error('mock');
  }
  async rotatePassportEncryptionKey(
    _: Identity,
    __: string,
    ___: Identity,
  ): Promise<PatientPassport> {
    throw new Error('mock');
  }
  async createRecord(_: CreateRecordInput): Promise<MedicalRecord> {
    throw new Error('mock');
  }
  async getRecord(_: Identity): Promise<MedicalRecord | null> {
    return null;
  }
  async listRecordsForPatient(
    patient: Identity,
    options: { types?: RecordType[]; limit?: number; cursor?: string } = {},
  ): Promise<{ records: MedicalRecord[]; nextCursor: string | null }> {
    let records = this.records.get(patient) ?? [];
    if (options.types && options.types.length > 0) {
      const allow = new Set(options.types);
      records = records.filter((r) => allow.has(r.recordType));
    }
    return { records, nextCursor: null };
  }
  async setRecordStatus(_: Identity, __: RecordStatus, ___: Identity): Promise<MedicalRecord> {
    throw new Error('mock');
  }
  async createGrant(_: CreateGrantInput): Promise<AccessGrant> {
    throw new Error('mock');
  }
  async getGrant(_: Identity): Promise<AccessGrant | null> {
    return null;
  }
  async findActiveGrant(): Promise<AccessGrant | null> {
    return null;
  }
  async recordGrantAccess(_: Identity): Promise<AccessGrant> {
    throw new Error('mock');
  }
  async revokeGrant(_: Identity, __: Identity): Promise<AccessGrant> {
    throw new Error('mock');
  }
  async expireGrants(_: number): Promise<number> {
    return 0;
  }
  async recordConsent(_: CreateConsentInput): Promise<ConsentRecord> {
    throw new Error('mock');
  }
  async getConsent(_: Identity): Promise<ConsentRecord | null> {
    return null;
  }
  async listConsentsForPatient(patient: Identity): Promise<ConsentRecord[]> {
    return this.consents.get(patient) ?? [];
  }
  async revokeConsent(_: Identity, __: Identity, ___: number): Promise<ConsentRecord> {
    throw new Error('mock');
  }
  async appendAudit(_: CreateAuditInput): Promise<AuditEntry> {
    throw new Error('mock');
  }
  async getAuditEntry(_: number): Promise<AuditEntry | null> {
    return null;
  }
  async verifyAuditChain(): Promise<{ entries: AuditEntry[]; rootHash: Hash; valid: boolean }> {
    throw new Error('mock');
  }
  async listAuditForPatient(patient: Identity): Promise<AuditEntry[]> {
    return this.audit.get(patient) ?? [];
  }
}

describeIfDb('Federation: PatientBridgeStore + Ed25519 verifier (Postgres)', () => {
  let pool: Pool;
  let store: PatientBridgeStore;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    store = new PatientBridgeStore(pool, new AcceptAllVerifier());
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE patient_bridges, audit_log, consent_records, access_grants, medical_records, patient_passports, audit_checkpoints RESTART IDENTITY CASCADE',
    );
  });

  it('creates an admin-imported bridge and looks it up by local id', async () => {
    const passport = await mkPassport(pool);
    const bridge = await store.createBridge({
      localPassportId: passport.id,
      onchainPassportId: 'wallet-AAA',
      establishedVia: 'admin_imported',
      onchainRecordTypes: [RecordType.Note, RecordType.Lab],
    });
    expect(bridge.id).toMatch(/^[0-9a-f-]{36}$/);

    const found = await store.findByLocal(passport.id);
    expect(found).not.toBeNull();
    expect(found!.onchainPassportId).toBe('wallet-AAA');
    expect(found!.onchainRecordTypes).toEqual(['note', 'lab']);
  });

  it('rejects a bridge with no ids on either side', async () => {
    await expect(
      store.createBridge({
        localPassportId: null,
        onchainPassportId: null,
        establishedVia: 'admin_imported',
      }),
    ).rejects.toThrow();
  });

  it('rejects patient_signed without signature fields', async () => {
    const passport = await mkPassport(pool);
    await expect(
      store.createBridge({
        localPassportId: passport.id,
        onchainPassportId: 'wallet-X',
        establishedVia: 'patient_signed',
        // signature fields missing
      }),
    ).rejects.toThrow(/signatureB64/i);
  });

  it('rejects patient_signed when the verifier returns false', async () => {
    const rejecting = new PatientBridgeStore(pool, new RejectAllVerifier());
    const passport = await mkPassport(pool);
    await expect(
      rejecting.createBridge({
        localPassportId: passport.id,
        onchainPassportId: 'wallet-bad',
        establishedVia: 'patient_signed',
        signatureB64: Buffer.alloc(64).toString('base64'),
        signatureNonce: 'nonce',
        signatureTimestamp: nowSec(),
      }),
    ).rejects.toThrow(/verification failed/i);
  });

  it('rejects patient_signed when the timestamp is outside the skew window', async () => {
    const passport = await mkPassport(pool);
    await expect(
      store.createBridge({
        localPassportId: passport.id,
        onchainPassportId: 'wallet-stale',
        establishedVia: 'patient_signed',
        signatureB64: Buffer.alloc(64).toString('base64'),
        signatureNonce: 'nonce',
        signatureTimestamp: nowSec() - 600, // 10 minutes ago
      }),
    ).rejects.toThrow(/skew/i);
  });

  it('Ed25519 verifier accepts a real Node-generated signature', async () => {
    // Generate an Ed25519 keypair using Node, sign canonicalizeBridge,
    // and feed it through the verifier. We don't need a real Solana
    // wallet; the verifier doesn't care about provenance, only math.
    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const rawPubkey = publicKey.export({ format: 'der', type: 'spki' }).slice(-32);
    const pubkeyB58 = base58Encode(rawPubkey);

    const payload: BridgePayload = {
      localPassportId: 'local-uuid-1234',
      onchainPassportId: pubkeyB58,
      nonce: 'random-nonce-' + Math.random().toString(36).slice(2),
      timestamp: nowSec(),
    };
    const message = Buffer.from(canonicalizeBridge(payload), 'utf8');
    const signature = cryptoSign(null, message, privateKey);
    const signatureB64 = signature.toString('base64');

    const verifier = new Ed25519BridgeVerifier();
    expect(verifier.verify(payload, signatureB64, pubkeyB58)).toBe(true);

    // Tamper with the payload — verifier must reject.
    expect(verifier.verify({ ...payload, nonce: 'tampered' }, signatureB64, pubkeyB58)).toBe(
      false,
    );

    // Wrong pubkey — verifier must reject.
    const otherPair = generateKeyPairSync('ed25519');
    const otherRaw = otherPair.publicKey.export({ format: 'der', type: 'spki' }).slice(-32);
    expect(verifier.verify(payload, signatureB64, base58Encode(otherRaw))).toBe(false);
  });

  it('end-to-end: PatientBridgeStore accepts a Postgres bridge with a real Ed25519 signature', async () => {
    const realStore = new PatientBridgeStore(pool, new Ed25519BridgeVerifier());
    const passport = await mkPassport(pool);

    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const rawPubkey = publicKey.export({ format: 'der', type: 'spki' }).slice(-32);
    const pubkeyB58 = base58Encode(rawPubkey);

    const ts = nowSec();
    const payload: BridgePayload = {
      localPassportId: passport.id,
      onchainPassportId: pubkeyB58,
      nonce: 'real-nonce',
      timestamp: ts,
    };
    const sig = cryptoSign(null, Buffer.from(canonicalizeBridge(payload), 'utf8'), privateKey);

    const bridge = await realStore.createBridge({
      localPassportId: passport.id,
      onchainPassportId: pubkeyB58,
      establishedVia: 'patient_signed',
      signatureB64: sig.toString('base64'),
      signatureNonce: 'real-nonce',
      signatureTimestamp: ts,
      onchainRecordTypes: [RecordType.Lab],
    });
    expect(bridge.establishedVia).toBe('patient_signed');
    expect(bridge.signatureB64).not.toBeNull();
  });

  it('revoke flips revoked_at and excludes the row from findByLocal', async () => {
    const passport = await mkPassport(pool);
    const bridge = await store.createBridge({
      localPassportId: passport.id,
      onchainPassportId: 'wallet-Z',
      establishedVia: 'admin_imported',
    });
    expect(await store.findByLocal(passport.id)).not.toBeNull();

    await store.revoke(bridge.id);
    expect(await store.findByLocal(passport.id)).toBeNull();
  });
});

describeIfDb('Federation: FederatedVaultDriver (merges local + mock onchain)', () => {
  let pool: Pool;
  let local: LocalVaultDriver;
  let onchain: MockOnchainDriver;
  let store: PatientBridgeStore;
  let federated: FederatedVaultDriver;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    local = new LocalVaultDriver({ pool });
    onchain = new MockOnchainDriver();
    store = new PatientBridgeStore(pool, new AcceptAllVerifier());
    federated = new FederatedVaultDriver({ local, onchain, bridgeStore: store });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE patient_bridges, audit_log, consent_records, access_grants, medical_records, patient_passports, audit_checkpoints RESTART IDENTITY CASCADE',
    );
    onchain = new MockOnchainDriver();
    federated = new FederatedVaultDriver({ local, onchain, bridgeStore: store });
  });

  it('info() reports federated backend with both child versions', async () => {
    const info = federated.info();
    expect(info.kind).toBe('local');
    expect(info.backend).toMatch(/federated/);
    expect(info.backend).toMatch(/postgres/);
  });

  it('listRecordsForPatient returns local records when no bridge exists', async () => {
    const passport = await mkPassportLocal(local);
    await local.createRecord(makeRecord(passport.id, RecordType.Lab, 1));

    const result = await federated.listRecordsForPatient(passport.id);
    expect(result.records.length).toBe(1);
    expect(result.records[0].recordType).toBe('lab');
  });

  it('listRecordsForPatient merges local + on-chain when bridge is active and types are allowed', async () => {
    const passport = await mkPassportLocal(local);
    await local.createRecord(makeRecord(passport.id, RecordType.Lab, 1));

    const onchainWallet = 'wallet-merge-' + Date.now();
    onchain.seed(onchainWallet, {
      records: [
        // Pretend the patient brought a prior prescription from another hospital.
        {
          id: 'onchain-rec-1',
          patientPassport: onchainWallet,
          recordType: RecordType.Prescription,
          contentHash: 'aa'.repeat(32),
          storageLocator: 'ipfs://Qm...',
          abePolicy: 'patient-curated',
          author: 'doctor:alice',
          authorCredentialHash: 'bb'.repeat(32),
          icdCodesHash: 'cc'.repeat(32),
          createdAt: nowSec() + 100, // newer than local
          status: RecordStatus.Final,
          supersedes: null,
        },
      ],
    });

    await store.createBridge({
      localPassportId: passport.id,
      onchainPassportId: onchainWallet,
      establishedVia: 'admin_imported',
      onchainRecordTypes: [RecordType.Prescription],
    });

    const result = await federated.listRecordsForPatient(passport.id);
    expect(result.records.length).toBe(2);
    // Sorted desc by createdAt — onchain (with timestamp +100) comes first.
    expect(result.records[0].recordType).toBe('prescription');
    expect(result.records[0].abePolicy).toMatch(/source:onchain/);
    expect(result.records[1].recordType).toBe('lab');
  });

  it('listRecordsForPatient honours patient onchain_record_types allowlist', async () => {
    const passport = await mkPassportLocal(local);
    await local.createRecord(makeRecord(passport.id, RecordType.Lab, 1));

    const onchainWallet = 'wallet-allow-' + Date.now();
    // Patient has imaging on-chain, but did NOT authorize the hospital
    // to read imaging records via the bridge.
    onchain.seed(onchainWallet, {
      records: [
        {
          id: 'onchain-img',
          patientPassport: onchainWallet,
          recordType: RecordType.Imaging,
          contentHash: 'aa'.repeat(32),
          storageLocator: 'ipfs://...',
          abePolicy: '',
          author: 'doctor:b',
          authorCredentialHash: 'bb'.repeat(32),
          icdCodesHash: 'cc'.repeat(32),
          createdAt: nowSec(),
          status: RecordStatus.Final,
          supersedes: null,
        },
      ],
    });
    await store.createBridge({
      localPassportId: passport.id,
      onchainPassportId: onchainWallet,
      establishedVia: 'admin_imported',
      onchainRecordTypes: [RecordType.Note], // imaging NOT included
    });

    const result = await federated.listRecordsForPatient(passport.id);
    expect(result.records.length).toBe(1); // only local lab; onchain imaging blocked
    expect(result.records[0].recordType).toBe('lab');
  });

  it('listRecordsForPatient ignores on-chain records when bridge is revoked', async () => {
    const passport = await mkPassportLocal(local);
    const onchainWallet = 'wallet-revoked-' + Date.now();
    onchain.seed(onchainWallet, {
      records: [
        {
          id: 'onchain-1',
          patientPassport: onchainWallet,
          recordType: RecordType.Note,
          contentHash: 'aa'.repeat(32),
          storageLocator: 's',
          abePolicy: '',
          author: 'a',
          authorCredentialHash: 'bb'.repeat(32),
          icdCodesHash: 'cc'.repeat(32),
          createdAt: nowSec(),
          status: RecordStatus.Final,
          supersedes: null,
        },
      ],
    });
    const bridge = await store.createBridge({
      localPassportId: passport.id,
      onchainPassportId: onchainWallet,
      establishedVia: 'admin_imported',
      onchainRecordTypes: [RecordType.Note],
    });
    await store.revoke(bridge.id);

    const result = await federated.listRecordsForPatient(passport.id);
    expect(result.records.length).toBe(0); // revoked bridge → no on-chain reads
  });

  it('listRecordsForPatient is resilient when on-chain RPC throws', async () => {
    const passport = await mkPassportLocal(local);
    await local.createRecord(makeRecord(passport.id, RecordType.Note, 5));

    // Replace mock with one that throws on every list call. Use unknown
    // cast because we're intentionally subverting the interface for the
    // failure-mode test.
    const throwingOnchain = {
      ...onchain,
      info: () => ({ kind: 'onchain' as const, backend: 'broken', version: 'x' }),
      listRecordsForPatient: () => Promise.reject(new Error('rpc down')),
    } as unknown as VaultDriver;
    const f = new FederatedVaultDriver({
      local,
      onchain: throwingOnchain,
      bridgeStore: store,
    });

    await store.createBridge({
      localPassportId: passport.id,
      onchainPassportId: 'wallet-broken',
      establishedVia: 'admin_imported',
      onchainRecordTypes: [RecordType.Note],
    });

    // Local result must still be returned even though on-chain blew up.
    const result = await f.listRecordsForPatient(passport.id);
    expect(result.records.length).toBe(1);
  });

  it('createRecord goes to local only — never tries to write on-chain', async () => {
    const passport = await mkPassportLocal(local);
    await store.createBridge({
      localPassportId: passport.id,
      onchainPassportId: 'wallet-W',
      establishedVia: 'admin_imported',
      onchainRecordTypes: [RecordType.Lab],
    });

    // The mock onchain driver throws on createRecord. If federated ever
    // dispatched writes there, this test would surface it.
    const created = await federated.createRecord(makeRecord(passport.id, RecordType.Lab, 99));
    expect(created.patientPassport).toBe(passport.id);
  });
});

// ============================================================
// Helpers
// ============================================================

function makeRecord(
  patientPassport: string,
  type: RecordType,
  seed: number,
): CreateRecordInput {
  return {
    patientPassport,
    recordType: type,
    contentHash: make32Hex(seed),
    storageLocator: `s3://b/${seed}`,
    abePolicy: '',
    author: 'doctor:test',
    authorCredentialHash: make32Hex(seed + 1),
    icdCodesHash: make32Hex(seed + 2),
  };
}

async function mkPassport(pool: Pool): Promise<{ id: string }> {
  // Insert directly so we don't depend on the driver in store-only tests.
  const { rows } = await pool.query(
    `INSERT INTO patient_passports
       (authority, mrn_hash, identity_hash, public_encryption_key,
        recovery_threshold, guardians, emergency_hospital_shard)
     VALUES ($1, decode($2,'hex'), decode($3,'hex'), $4, 1, ARRAY['g1'], false)
     RETURNING id`,
    ['patient:test', randHex32(), randHex32(), 'pk'],
  );
  return { id: rows[0].id };
}

async function mkPassportLocal(driver: LocalVaultDriver) {
  return driver.createPassport({
    authority: 'patient:fed-' + Date.now() + '-' + Math.random().toString(36).slice(2),
    mrnHash: randHex32(),
    identityHash: randHex32(),
    publicEncryptionKey: 'pk',
    recoveryThreshold: 1,
    guardians: ['g1'],
    emergencyHospitalShard: false,
  });
}

// Minimal base58 encoder (matches base58Decode in ed25519-verifier).
function base58Encode(bytes: Uint8Array): string {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = [];
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = '';
  for (let i = 0; i < zeros; i++) out += '1';
  for (let i = digits.length - 1; i >= 0; i--) out += ALPHABET[digits[i]];
  return out;
}
