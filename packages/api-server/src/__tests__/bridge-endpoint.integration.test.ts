/**
 * MediHive — Copyright (C) 2024-2026 The MediHive Authors
 * Licensed under the GNU Affero General Public License v3.0 or later.
 *
 * API-level integration test for the federated profile's bridge-link
 * endpoint. Boots a Hono app with FederatedVaultDriver + real Postgres
 * + Ed25519BridgeVerifier, then issues real HTTP requests with
 * real Ed25519 signatures.
 *
 * Skipped if DATABASE_URL is unset.
 */

import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { generateKeyPairSync, sign as cryptoSign } from 'crypto';
import {
  Ed25519BridgeVerifier,
  FederatedVaultDriver,
  LocalVaultDriver,
  PatientBridgeStore,
  canonicalizeBridge,
} from '@medi-hive/local-vault';
import { vaultMiddleware } from '../middleware/vault';
import { patientRoutes } from '../routes/patient';
import { AppEnv } from '../types';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const randHex32 = (): string => {
  const b = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) b[i] = Math.floor(Math.random() * 256);
  return b.toString('hex');
};

const nowSec = () => Math.floor(Date.now() / 1000);

// Minimal base58 encoder (mirror of the one in ed25519-verifier).
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

class StubOnchain {
  // We don't exercise on-chain reads here; the bridge endpoint only
  // needs the bridge store + local driver. The federated driver still
  // requires an onchain driver in its constructor, so this is the
  // smallest valid stand-in.
  info() {
    return { kind: 'onchain' as const, backend: 'stub', version: 'test' };
  }
  // The federated driver only invokes on-chain methods inside list*
  // methods we don't call from the bridge endpoint, but TypeScript
  // wants a full interface — the file casts at the boundary.
}

describeIfDb('POST /api/patient/v2/bridge (federated profile, real Postgres)', () => {
  let pool: Pool;
  let local: LocalVaultDriver;
  let store: PatientBridgeStore;
  let federated: FederatedVaultDriver;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    local = new LocalVaultDriver({ pool });
    store = new PatientBridgeStore(pool, new Ed25519BridgeVerifier());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const onchainStub = new StubOnchain() as any;
    federated = new FederatedVaultDriver({
      local,
      onchain: onchainStub,
      bridgeStore: store,
    });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE patient_bridges, audit_log, consent_records, access_grants, medical_records, patient_passports, audit_checkpoints RESTART IDENTITY CASCADE',
    );
  });

  function buildApp(authPubkey: string): Hono<AppEnv> {
    const app = new Hono<AppEnv>();
    app.use(
      '*',
      vaultMiddleware({ driver: federated, bridgeStore: store }),
    );
    app.use('*', async (c, next) => {
      c.set('auth', {
        pubkey: authPubkey,
        role: 'patient',
        permissions: ['passport', 'records:own'],
      });
      await next();
    });
    app.route('/api/patient', patientRoutes);
    return app;
  }

  it('accepts a properly-signed bridge and returns 201 with the new row', async () => {
    const passport = await local.createPassport({
      authority: 'patient:bridge-happy',
      mrnHash: randHex32(),
      identityHash: randHex32(),
      publicEncryptionKey: 'pk',
      recoveryThreshold: 1,
      guardians: ['g1'],
      emergencyHospitalShard: false,
    });

    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const rawPubkey = publicKey.export({ format: 'der', type: 'spki' }).slice(-32);
    const pubkeyB58 = base58Encode(rawPubkey);

    const ts = nowSec();
    const nonce = 'happy-nonce';
    const message = canonicalizeBridge({
      localPassportId: passport.id,
      onchainPassportId: pubkeyB58,
      nonce,
      timestamp: ts,
    });
    const sig = cryptoSign(null, Buffer.from(message, 'utf8'), privateKey);

    const app = buildApp(pubkeyB58);
    const res = await app.request('/api/patient/v2/bridge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        localPassportId: passport.id,
        onchainPassportId: pubkeyB58,
        signatureB64: sig.toString('base64'),
        nonce,
        timestamp: ts,
        onchainRecordTypes: ['lab', 'prescription'],
      }),
    });

    expect(res.status).toBe(201);
    const body = (await res.json()) as { bridge: { id: string; onchainRecordTypes: string[] } };
    expect(body.bridge.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.bridge.onchainRecordTypes).toEqual(['lab', 'prescription']);
  });

  it('rejects a bridge whose signature does not verify (400)', async () => {
    const passport = await local.createPassport({
      authority: 'patient:bridge-bad-sig',
      mrnHash: randHex32(),
      identityHash: randHex32(),
      publicEncryptionKey: 'pk',
      recoveryThreshold: 1,
      guardians: ['g1'],
      emergencyHospitalShard: false,
    });

    // Generate a real keypair but submit a bogus signature.
    const { publicKey } = generateKeyPairSync('ed25519');
    const rawPubkey = publicKey.export({ format: 'der', type: 'spki' }).slice(-32);
    const pubkeyB58 = base58Encode(rawPubkey);

    const app = buildApp(pubkeyB58);
    const res = await app.request('/api/patient/v2/bridge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        localPassportId: passport.id,
        onchainPassportId: pubkeyB58,
        signatureB64: Buffer.alloc(64, 0).toString('base64'), // all-zero signature
        nonce: 'bad',
        timestamp: nowSec(),
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/verification failed/i);
  });

  it('rejects a bridge when auth.pubkey does not match onchainPassportId (403)', async () => {
    const passport = await local.createPassport({
      authority: 'patient:bridge-mismatch',
      mrnHash: randHex32(),
      identityHash: randHex32(),
      publicEncryptionKey: 'pk',
      recoveryThreshold: 1,
      guardians: ['g1'],
      emergencyHospitalShard: false,
    });

    // Auth is wallet-A, but request claims wallet-B as onchainPassportId.
    const app = buildApp('wallet-A');
    const res = await app.request('/api/patient/v2/bridge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        localPassportId: passport.id,
        onchainPassportId: 'wallet-B',
        signatureB64: Buffer.alloc(64).toString('base64'),
        nonce: 'n',
        timestamp: nowSec(),
      }),
    });
    expect(res.status).toBe(403);
  });

  it('rejects a bridge with a stale timestamp (400)', async () => {
    const passport = await local.createPassport({
      authority: 'patient:bridge-stale',
      mrnHash: randHex32(),
      identityHash: randHex32(),
      publicEncryptionKey: 'pk',
      recoveryThreshold: 1,
      guardians: ['g1'],
      emergencyHospitalShard: false,
    });

    const { publicKey, privateKey } = generateKeyPairSync('ed25519');
    const rawPubkey = publicKey.export({ format: 'der', type: 'spki' }).slice(-32);
    const pubkeyB58 = base58Encode(rawPubkey);

    const ts = nowSec() - 600; // 10 min ago, past the 5 min window
    const message = canonicalizeBridge({
      localPassportId: passport.id,
      onchainPassportId: pubkeyB58,
      nonce: 'stale',
      timestamp: ts,
    });
    const sig = cryptoSign(null, Buffer.from(message, 'utf8'), privateKey);

    const app = buildApp(pubkeyB58);
    const res = await app.request('/api/patient/v2/bridge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        localPassportId: passport.id,
        onchainPassportId: pubkeyB58,
        signatureB64: sig.toString('base64'),
        nonce: 'stale',
        timestamp: ts,
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/skew/i);
  });

  it('DELETE /v2/bridge/:id revokes an existing bridge', async () => {
    const passport = await local.createPassport({
      authority: 'patient:bridge-revoke',
      mrnHash: randHex32(),
      identityHash: randHex32(),
      publicEncryptionKey: 'pk',
      recoveryThreshold: 1,
      guardians: ['g1'],
      emergencyHospitalShard: false,
    });
    const bridge = await store.createBridge({
      localPassportId: passport.id,
      onchainPassportId: 'wallet-revoke',
      establishedVia: 'admin_imported',
      onchainRecordTypes: [],
    });
    const app = buildApp('wallet-revoke');
    const res = await app.request(`/api/patient/v2/bridge/${bridge.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { bridge: { revokedAt: number | null } };
    expect(body.bridge.revokedAt).toBeGreaterThan(0);
  });
});

describe('POST /api/patient/v2/bridge on local profile (no bridge store)', () => {
  // No DB needed for this branch.
  it('returns 404 with a helpful hint when bridgeStore is absent', async () => {
    const app = new Hono<AppEnv>();
    // Inject a null bridgeStore by supplying only the driver.
    app.use('*', async (c, next) => {
      c.set('vault', {} as never);
      // bridgeStore intentionally NOT set
      c.set('auth', {
        pubkey: 'wallet-X',
        role: 'patient',
        permissions: ['passport'],
      });
      await next();
    });
    app.route('/api/patient', patientRoutes);

    const res = await app.request('/api/patient/v2/bridge', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        localPassportId: 'p',
        onchainPassportId: 'wallet-X',
        signatureB64: 'sig',
        nonce: 'n',
        timestamp: nowSec(),
      }),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; hint: string };
    expect(body.error).toMatch(/federated/i);
    expect(body.hint).toMatch(/MEDIHIVE_PROFILE/i);
  });
});
