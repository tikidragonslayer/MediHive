/**
 * MediHive — Copyright (C) 2024-2026 The MediHive Authors
 * Licensed under the GNU Affero General Public License v3.0 or later.
 *
 * Integration tests for LocalVaultDriver against a real Postgres.
 *
 * These tests require a running Postgres reachable via DATABASE_URL.
 * They are skipped if DATABASE_URL is unset, so the unit-test suite
 * still runs in environments without Postgres (e.g. some CI runners).
 *
 * Each test creates fresh state and cleans up after itself so the suite
 * is order-independent.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Pool } from 'pg';
import {
  AuditAction,
  ConsentMethod,
  ConsentType,
  GrantStatus,
  PassportStatus,
  RecordStatus,
  RecordType,
} from '@medi-hive/vault-driver';
import { LocalVaultDriver } from '../driver';

const DATABASE_URL = process.env.DATABASE_URL;
const describeIfDb = DATABASE_URL ? describe : describe.skip;

const make32Hex = (seed: number): string =>
  Buffer.from(Array.from({ length: 32 }, (_, i) => (seed + i) & 0xff)).toString('hex');

const ZERO_HASH_HEX = '0'.repeat(64);

describeIfDb('LocalVaultDriver (integration, requires Postgres)', () => {
  let pool: Pool;
  let driver: LocalVaultDriver;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    driver = new LocalVaultDriver({ pool });
  });

  afterAll(async () => {
    await pool.end();
  });

  beforeEach(async () => {
    // Reset all tables. Truncate cascades through FKs. audit_log is
    // append-only at the application level (UPDATE/DELETE are blocked by
    // triggers), but TRUNCATE bypasses row-level triggers, so it works
    // here for test setup.
    await pool.query(
      'TRUNCATE audit_log, consent_records, access_grants, medical_records, patient_passports, audit_checkpoints RESTART IDENTITY CASCADE',
    );
  });

  // ============================================================
  // Patient passports
  // ============================================================

  describe('patient passports', () => {
    it('creates a passport and reads it back', async () => {
      const guardians = ['guardian-a', 'guardian-b', 'guardian-c'];
      const created = await driver.createPassport({
        authority: 'patient:alice',
        mrnHash: make32Hex(0x10),
        identityHash: make32Hex(0x20),
        publicEncryptionKey: 'base64-encoded-pubkey',
        recoveryThreshold: 2,
        guardians,
        emergencyHospitalShard: false,
      });

      expect(created.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(created.authority).toBe('patient:alice');
      expect(created.status).toBe(PassportStatus.Active);
      expect(created.guardians).toEqual(guardians);

      const fetched = await driver.getPassport(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.id).toBe(created.id);
      expect(fetched!.mrnHash).toBe(make32Hex(0x10));
    });

    it('rejects guardians shorter than the recovery threshold', async () => {
      await expect(
        driver.createPassport({
          authority: 'patient:bob',
          mrnHash: make32Hex(0x30),
          identityHash: make32Hex(0x40),
          publicEncryptionKey: 'k',
          recoveryThreshold: 5,
          guardians: ['only-one'],
          emergencyHospitalShard: false,
        }),
      ).rejects.toThrow();
    });

    it('rejects duplicate MRN hashes', async () => {
      await driver.createPassport({
        authority: 'patient:alice',
        mrnHash: make32Hex(0xaa),
        identityHash: make32Hex(0xbb),
        publicEncryptionKey: 'k',
        recoveryThreshold: 1,
        guardians: ['g1'],
        emergencyHospitalShard: false,
      });
      await expect(
        driver.createPassport({
          authority: 'patient:alice-twin',
          mrnHash: make32Hex(0xaa),
          identityHash: make32Hex(0xcc),
          publicEncryptionKey: 'k',
          recoveryThreshold: 1,
          guardians: ['g1'],
          emergencyHospitalShard: false,
        }),
      ).rejects.toThrow();
    });

    it('updates passport status and appends an audit entry', async () => {
      const passport = await mkPassport(driver);
      const updated = await driver.setPassportStatus(passport.id, PassportStatus.Suspended, 'admin:carol');
      expect(updated.status).toBe(PassportStatus.Suspended);

      const audit = await driver.listAuditForPatient(passport.id);
      expect(audit.length).toBe(1);
      expect(audit[0].action).toBe(AuditAction.ConsentChange);
      expect(audit[0].actor).toBe('admin:carol');
    });

    it('rotates encryption key and audits a key rotation', async () => {
      const passport = await mkPassport(driver);
      const rotated = await driver.rotatePassportEncryptionKey(
        passport.id,
        'new-base64-pubkey',
        'admin:dave',
      );
      expect(rotated.publicEncryptionKey).toBe('new-base64-pubkey');

      const audit = await driver.listAuditForPatient(passport.id);
      expect(audit[0].action).toBe(AuditAction.KeyRotation);
    });
  });

  // ============================================================
  // Medical records
  // ============================================================

  describe('medical records', () => {
    it('creates and lists records for a patient with type filtering', async () => {
      const passport = await mkPassport(driver);
      await driver.createRecord({
        patientPassport: passport.id,
        recordType: RecordType.Note,
        contentHash: make32Hex(1),
        storageLocator: 's3://bucket/note-1',
        abePolicy: 'role:doctor',
        author: 'doctor:eve',
        authorCredentialHash: make32Hex(2),
        icdCodesHash: make32Hex(3),
      });
      await driver.createRecord({
        patientPassport: passport.id,
        recordType: RecordType.Lab,
        contentHash: make32Hex(4),
        storageLocator: 's3://bucket/lab-1',
        abePolicy: 'role:doctor,role:lab',
        author: 'lab:frank',
        authorCredentialHash: make32Hex(5),
        icdCodesHash: make32Hex(6),
      });

      const all = await driver.listRecordsForPatient(passport.id);
      expect(all.records.length).toBe(2);
      expect(all.nextCursor).toBeNull();

      const labsOnly = await driver.listRecordsForPatient(passport.id, {
        types: [RecordType.Lab],
      });
      expect(labsOnly.records.length).toBe(1);
      expect(labsOnly.records[0].recordType).toBe(RecordType.Lab);
    });

    it('blocks deletion of records past draft state', async () => {
      const passport = await mkPassport(driver);
      const record = await driver.createRecord({
        patientPassport: passport.id,
        recordType: RecordType.Note,
        contentHash: make32Hex(7),
        storageLocator: 's3://bucket/n',
        abePolicy: '',
        author: 'doctor:gina',
        authorCredentialHash: make32Hex(8),
        icdCodesHash: make32Hex(9),
      });
      // Promote to Final.
      await driver.setRecordStatus(record.id, RecordStatus.Final, 'doctor:gina');

      // Direct DELETE should be blocked by trigger.
      await expect(
        pool.query('DELETE FROM medical_records WHERE id = $1', [record.id]),
      ).rejects.toThrow(/past draft/i);
    });

    it('paginates with cursor', async () => {
      const passport = await mkPassport(driver);
      for (let i = 0; i < 5; i++) {
        await driver.createRecord({
          patientPassport: passport.id,
          recordType: RecordType.Note,
          contentHash: make32Hex(0x40 + i),
          storageLocator: `s3://b/${i}`,
          abePolicy: '',
          author: 'doctor:h',
          authorCredentialHash: make32Hex(0x50 + i),
          icdCodesHash: make32Hex(0x60 + i),
        });
        // small delay so created_at differs
        await sleep(5);
      }
      const page1 = await driver.listRecordsForPatient(passport.id, { limit: 3 });
      expect(page1.records.length).toBe(3);
      expect(page1.nextCursor).not.toBeNull();
      const page2 = await driver.listRecordsForPatient(passport.id, {
        limit: 3,
        cursor: page1.nextCursor!,
      });
      expect(page2.records.length).toBe(2);
      expect(page2.nextCursor).toBeNull();
    });
  });

  // ============================================================
  // Access grants
  // ============================================================

  describe('access grants', () => {
    it('creates an active grant and finds it', async () => {
      const passport = await mkPassport(driver);
      const now = nowSec();
      const grant = await driver.createGrant({
        patient: passport.id,
        grantee: 'doctor:isaac',
        scope: {
          recordTypes: [RecordType.Note, RecordType.Lab],
          departments: ['internal-medicine'],
          read: true,
          write: false,
          emergency: false,
        },
        reEncryptionKey: 'rek-base64',
        validFrom: now - 60,
        validUntil: now + 3600,
        grantReason: 'inpatient consult',
      });
      expect(grant.status).toBe(GrantStatus.Active);

      const found = await driver.findActiveGrant(passport.id, 'doctor:isaac');
      expect(found).not.toBeNull();
      expect(found!.id).toBe(grant.id);
    });

    it('rejects emergency grants longer than 4 hours', async () => {
      const passport = await mkPassport(driver);
      const now = nowSec();
      await expect(
        driver.createGrant({
          patient: passport.id,
          grantee: 'doctor:jane',
          scope: {
            recordTypes: [RecordType.Note],
            departments: [],
            read: true,
            write: true,
            emergency: true,
          },
          reEncryptionKey: 'rek',
          validFrom: now,
          validUntil: now + 5 * 3600, // 5h — exceeds the 4h cap
          grantReason: 'break-glass',
        }),
      ).rejects.toThrow();
    });

    it('expireGrants flips status when validUntil has passed', async () => {
      const passport = await mkPassport(driver);
      const now = nowSec();
      await driver.createGrant({
        patient: passport.id,
        grantee: 'doctor:k',
        scope: {
          recordTypes: [RecordType.Note],
          departments: [],
          read: true,
          write: false,
          emergency: false,
        },
        reEncryptionKey: 'rek',
        validFrom: now - 7200,
        validUntil: now - 60, // already expired
        grantReason: 'old',
      });
      const expired = await driver.expireGrants(now);
      expect(expired).toBeGreaterThanOrEqual(1);

      const active = await driver.findActiveGrant(passport.id, 'doctor:k');
      expect(active).toBeNull();
    });

    it('revokeGrant flips status and audits', async () => {
      const passport = await mkPassport(driver);
      const now = nowSec();
      const grant = await driver.createGrant({
        patient: passport.id,
        grantee: 'doctor:l',
        scope: {
          recordTypes: [RecordType.Note],
          departments: [],
          read: true,
          write: false,
          emergency: false,
        },
        reEncryptionKey: 'rek',
        validFrom: now,
        validUntil: now + 3600,
        grantReason: 'consult',
      });
      const revoked = await driver.revokeGrant(grant.id, 'admin:m');
      expect(revoked.status).toBe(GrantStatus.Revoked);
      const audit = await driver.listAuditForPatient(passport.id);
      expect(audit.some((e) => e.action === AuditAction.Revoke)).toBe(true);
    });
  });

  // ============================================================
  // Consent
  // ============================================================

  describe('consent', () => {
    it('records and revokes consent with audit trail', async () => {
      const passport = await mkPassport(driver);
      const now = nowSec();
      const consent = await driver.recordConsent({
        patient: passport.id,
        consentType: ConsentType.Treatment,
        scope: 'general care',
        validFrom: now,
        method: ConsentMethod.Digital,
        signature: 'ed25519-sig-base64',
      });
      expect(consent.revokedAt).toBeNull();

      const list = await driver.listConsentsForPatient(passport.id);
      expect(list.length).toBe(1);

      const revoked = await driver.revokeConsent(consent.id, 'patient:n', now + 100);
      expect(revoked.revokedAt).toBe(now + 100);

      const audit = await driver.listAuditForPatient(passport.id);
      expect(audit.some((e) => e.action === AuditAction.ConsentChange)).toBe(true);
    });
  });

  // ============================================================
  // Audit chain integrity
  // ============================================================

  describe('audit chain', () => {
    it('chains entries: each entry hash references the previous', async () => {
      const passport = await mkPassport(driver);
      const e1 = await driver.appendAudit({
        actor: 'doctor:o',
        action: AuditAction.View,
        targetPatient: passport.id,
        ipHash: make32Hex(0x70),
        deviceHash: make32Hex(0x71),
        metadata: 'first view',
      });
      const e2 = await driver.appendAudit({
        actor: 'doctor:o',
        action: AuditAction.View,
        targetPatient: passport.id,
        ipHash: make32Hex(0x72),
        deviceHash: make32Hex(0x73),
        metadata: 'second view',
      });
      // entry 2's prevHash must equal entry 1's entryHash.
      expect(e2.prevHash).toBe(e1.entryHash);
      // entry 1's prevHash must be the all-zero hash (chain start).
      expect(e1.prevHash).toBe(ZERO_HASH_HEX);
    });

    it('verifyAuditChain detects no tampering on a clean chain', async () => {
      const passport = await mkPassport(driver);
      for (let i = 0; i < 4; i++) {
        await driver.appendAudit({
          actor: `doctor:p${i}`,
          action: AuditAction.View,
          targetPatient: passport.id,
          ipHash: make32Hex(0x80 + i),
          deviceHash: make32Hex(0x90 + i),
          metadata: `v${i}`,
        });
      }
      const verify = await driver.verifyAuditChain(1, 4);
      expect(verify.entries.length).toBe(4);
      expect(verify.valid).toBe(true);
      expect(verify.rootHash).toBe(verify.entries[3].entryHash);
    });

    it('blocks UPDATE on audit_log via trigger', async () => {
      const passport = await mkPassport(driver);
      await driver.appendAudit({
        actor: 'doctor:q',
        action: AuditAction.View,
        targetPatient: passport.id,
        ipHash: make32Hex(0xa0),
        deviceHash: make32Hex(0xa1),
        metadata: 'will not be tampered',
      });
      await expect(
        pool.query("UPDATE audit_log SET metadata = 'TAMPERED' WHERE seq = 1"),
      ).rejects.toThrow(/append-only/i);
    });

    it('blocks DELETE on audit_log via trigger', async () => {
      const passport = await mkPassport(driver);
      await driver.appendAudit({
        actor: 'doctor:r',
        action: AuditAction.View,
        targetPatient: passport.id,
        ipHash: make32Hex(0xa2),
        deviceHash: make32Hex(0xa3),
        metadata: 'durable',
      });
      await expect(pool.query('DELETE FROM audit_log WHERE seq = 1')).rejects.toThrow(/append-only/i);
    });
  });
});

// ============================================================
// Helpers
// ============================================================

const nowSec = () => Math.floor(Date.now() / 1000);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function mkPassport(driver: LocalVaultDriver) {
  // Random MRN/identity hashes so concurrent tests don't collide on the
  // unique constraint.
  const randHex = () => {
    const b = Buffer.alloc(32);
    for (let i = 0; i < 32; i++) b[i] = Math.floor(Math.random() * 256);
    return b.toString('hex');
  };
  return driver.createPassport({
    authority: `patient:test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    mrnHash: randHex(),
    identityHash: randHex(),
    publicEncryptionKey: 'pk',
    recoveryThreshold: 1,
    guardians: ['g1'],
    emergencyHospitalShard: false,
  });
}
