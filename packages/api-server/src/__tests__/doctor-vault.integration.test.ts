/**
 * MediHive — Copyright (C) 2024-2026 The MediHive Authors
 * Licensed under the GNU Affero General Public License v3.0 or later.
 *
 * API-level integration test for the doctor's VaultDriver-backed
 * routes. Proves the grant-scoped read flow works end-to-end:
 *   HTTP → Hono → vault → access grant check → record list → audit append.
 *
 * Skipped if DATABASE_URL is unset.
 */

import { Hono } from 'hono';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import { LocalVaultDriver } from '@medi-hive/local-vault';
import { RecordType } from '@medi-hive/vault-driver';
import { vaultMiddleware } from '../middleware/vault';
import { doctorRoutes } from '../routes/doctor';
import { AppEnv } from '../types';

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

function buildTestApp(driver: LocalVaultDriver, doctorPubkey: string): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', vaultMiddleware(driver));
  app.use('*', async (c, next) => {
    c.set('auth', {
      pubkey: doctorPubkey,
      role: 'doctor',
      permissions: ['records:granted'],
    });
    await next();
  });
  app.route('/api/doctor', doctorRoutes);
  return app;
}

describeIfDb('doctor routes via VaultDriver (HTTP → Hono → Postgres)', () => {
  let pool: Pool;
  let driver: LocalVaultDriver;
  const doctorPubkey = `doctor-${Date.now()}`;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    driver = new LocalVaultDriver({ pool });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query(
      'TRUNCATE patient_bridges, audit_log, consent_records, access_grants, medical_records, patient_passports, audit_checkpoints RESTART IDENTITY CASCADE',
    );
  });

  async function seedPatientWithRecords(): Promise<{ passportId: string }> {
    const passport = await driver.createPassport({
      authority: 'patient:' + Math.random().toString(36).slice(2),
      mrnHash: randHex32(),
      identityHash: randHex32(),
      publicEncryptionKey: 'pk',
      recoveryThreshold: 1,
      guardians: ['g1'],
      emergencyHospitalShard: false,
    });
    await driver.createRecord({
      patientPassport: passport.id,
      recordType: RecordType.Lab,
      contentHash: make32Hex(1),
      storageLocator: 's3://b/1',
      abePolicy: '',
      author: 'lab:test',
      authorCredentialHash: make32Hex(2),
      icdCodesHash: make32Hex(3),
    });
    await driver.createRecord({
      patientPassport: passport.id,
      recordType: RecordType.Note,
      contentHash: make32Hex(4),
      storageLocator: 's3://b/2',
      abePolicy: '',
      author: 'doctor:other',
      authorCredentialHash: make32Hex(5),
      icdCodesHash: make32Hex(6),
    });
    return { passportId: passport.id };
  }

  it('GET /v2/patients/:id/records returns 403 when doctor has no grant', async () => {
    const { passportId } = await seedPatientWithRecords();
    const app = buildTestApp(driver, doctorPubkey);
    const res = await app.request(`/api/doctor/v2/patients/${passportId}/records`);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string; hint: string };
    expect(body.error).toMatch(/no active.*grant/i);
    expect(body.hint).toMatch(/access grant/i);
  });

  it('GET /v2/patients/:id/records returns 404 when passport does not exist', async () => {
    const app = buildTestApp(driver, doctorPubkey);
    const res = await app.request(
      `/api/doctor/v2/patients/00000000-0000-0000-0000-000000000000/records`,
    );
    expect(res.status).toBe(404);
  });

  it('GET /v2/patients/:id/records returns scoped records when grant is active', async () => {
    const { passportId } = await seedPatientWithRecords();

    // Patient grants this doctor read access to lab records only.
    await driver.createGrant({
      patient: passportId,
      grantee: doctorPubkey,
      scope: {
        recordTypes: [RecordType.Lab],
        departments: [],
        read: true,
        write: false,
        emergency: false,
      },
      reEncryptionKey: 'rek',
      validFrom: nowSec() - 60,
      validUntil: nowSec() + 3600,
      grantReason: 'consult',
    });

    const app = buildTestApp(driver, doctorPubkey);
    const res = await app.request(`/api/doctor/v2/patients/${passportId}/records`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      records: Array<{ recordType: string }>;
      grantId: string;
    };
    // Only the lab record is in scope; the note is filtered out.
    expect(body.records).toHaveLength(1);
    expect(body.records[0].recordType).toBe('lab');
    expect(body.grantId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('GET /v2/patients/:id/records appends a view audit entry', async () => {
    const { passportId } = await seedPatientWithRecords();
    await driver.createGrant({
      patient: passportId,
      grantee: doctorPubkey,
      scope: {
        recordTypes: [RecordType.Lab, RecordType.Note],
        departments: [],
        read: true,
        write: false,
        emergency: false,
      },
      reEncryptionKey: 'rek',
      validFrom: nowSec() - 60,
      validUntil: nowSec() + 3600,
      grantReason: 'consult',
    });

    const app = buildTestApp(driver, doctorPubkey);
    const res = await app.request(`/api/doctor/v2/patients/${passportId}/records`);
    expect(res.status).toBe(200);

    // Verify the audit log gained a 'view' entry by the doctor.
    const audit = await driver.listAuditForPatient(passportId);
    const viewEntry = audit.find((e) => e.action === 'view' && e.actor === doctorPubkey);
    expect(viewEntry).toBeDefined();
    expect(viewEntry!.metadata).toMatch(/doctor view/i);
  });

  it('GET /v2/patients/:id/records ?types= narrows to the intersection of request and grant scope', async () => {
    const { passportId } = await seedPatientWithRecords();
    await driver.createGrant({
      patient: passportId,
      grantee: doctorPubkey,
      scope: {
        recordTypes: [RecordType.Lab, RecordType.Note],
        departments: [],
        read: true,
        write: false,
        emergency: false,
      },
      reEncryptionKey: 'rek',
      validFrom: nowSec() - 60,
      validUntil: nowSec() + 3600,
      grantReason: 'consult',
    });

    const app = buildTestApp(driver, doctorPubkey);

    // Doctor requests imaging — outside the grant scope. Result: empty
    // with a hint, not 403 (the grant exists; the requested type is
    // just outside its scope).
    const resOut = await app.request(
      `/api/doctor/v2/patients/${passportId}/records?types=imaging`,
    );
    expect(resOut.status).toBe(200);
    const bodyOut = (await resOut.json()) as { records: unknown[]; hint: string };
    expect(bodyOut.records).toHaveLength(0);
    expect(bodyOut.hint).toMatch(/outside.*scope/i);

    // Doctor requests lab — inside the grant scope. Result: the lab record.
    const resIn = await app.request(`/api/doctor/v2/patients/${passportId}/records?types=lab`);
    expect(resIn.status).toBe(200);
    const bodyIn = (await resIn.json()) as { records: Array<{ recordType: string }> };
    expect(bodyIn.records).toHaveLength(1);
    expect(bodyIn.records[0].recordType).toBe('lab');
  });

  it('GET /v2/patients/:id/grant returns the active grant for this doctor', async () => {
    const { passportId } = await seedPatientWithRecords();
    await driver.createGrant({
      patient: passportId,
      grantee: doctorPubkey,
      scope: {
        recordTypes: [RecordType.Lab],
        departments: [],
        read: true,
        write: false,
        emergency: false,
      },
      reEncryptionKey: 'rek',
      validFrom: nowSec() - 60,
      validUntil: nowSec() + 3600,
      grantReason: 'consult',
    });

    const app = buildTestApp(driver, doctorPubkey);
    const res = await app.request(`/api/doctor/v2/patients/${passportId}/grant`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { grant: { grantee: string; status: string } };
    expect(body.grant.grantee).toBe(doctorPubkey);
    expect(body.grant.status).toBe('active');
  });

  it('GET /v2/patients/:id/grant returns 404 when no active grant exists', async () => {
    const { passportId } = await seedPatientWithRecords();
    const app = buildTestApp(driver, doctorPubkey);
    const res = await app.request(`/api/doctor/v2/patients/${passportId}/grant`);
    expect(res.status).toBe(404);
  });
});
