/**
 * MediHive — Copyright (C) 2024-2026 The MediHive Authors
 * Licensed under the GNU Affero General Public License v3.0 or later.
 *
 * Pure-function tests for the audit chain primitive. These do NOT require
 * a Postgres instance and run in CI.
 */

import { describe, expect, it } from 'vitest';
import {
  AuditPayload,
  ZERO_HASH,
  canonicalize,
  computeEntryHash,
  replayChain,
  verifyChain,
} from '../audit-chain';

const sample = (overrides: Partial<AuditPayload> = {}): AuditPayload => ({
  actor: 'doctor:alice',
  action: 'view',
  targetPatient: 'patient:bob',
  targetRecord: null,
  timestamp: 1700000000,
  ipHash: 'aa'.repeat(32),
  deviceHash: 'bb'.repeat(32),
  metadata: '',
  ...overrides,
});

describe('canonicalize', () => {
  it('is deterministic regardless of property insertion order', () => {
    const a = sample({ metadata: 'x' });
    // Build a payload with shuffled keys via spread.
    const shuffled = {
      metadata: a.metadata,
      ipHash: a.ipHash,
      timestamp: a.timestamp,
      action: a.action,
      actor: a.actor,
      targetRecord: a.targetRecord,
      targetPatient: a.targetPatient,
      deviceHash: a.deviceHash,
    } as AuditPayload;
    expect(canonicalize(a)).toBe(canonicalize(shuffled));
  });
});

describe('computeEntryHash', () => {
  it('produces 32-byte SHA-256 output', () => {
    const h = computeEntryHash(ZERO_HASH, sample());
    expect(h.length).toBe(32);
  });

  it('changes if any field changes', () => {
    const a = computeEntryHash(ZERO_HASH, sample());
    const b = computeEntryHash(ZERO_HASH, sample({ metadata: 'tampered' }));
    expect(a.equals(b)).toBe(false);
  });

  it('rejects non-32-byte prevHash', () => {
    expect(() => computeEntryHash(Buffer.alloc(31), sample())).toThrow();
  });
});

describe('replayChain + verifyChain', () => {
  it('produces a stable root for a sequence and verifies it', () => {
    const payloads = [
      sample({ action: 'create' }),
      sample({ action: 'view' }),
      sample({ action: 'amend', metadata: 'corrected dosage' }),
    ];
    const { entryHashes, rootHash } = replayChain(ZERO_HASH, payloads);
    expect(entryHashes.length).toBe(3);
    expect(rootHash.equals(entryHashes[2])).toBe(true);

    const reconstructed = [
      { prevHash: ZERO_HASH, entryHash: entryHashes[0], payload: payloads[0] },
      { prevHash: entryHashes[0], entryHash: entryHashes[1], payload: payloads[1] },
      { prevHash: entryHashes[1], entryHash: entryHashes[2], payload: payloads[2] },
    ];
    expect(verifyChain(reconstructed)).toBe(true);
  });

  it('detects tampering in the middle of the chain', () => {
    const payloads = [sample({ action: 'create' }), sample({ action: 'view' }), sample({ action: 'export' })];
    const { entryHashes } = replayChain(ZERO_HASH, payloads);
    // Adversary swaps in a different payload at index 1 but keeps the
    // stored entry hash. Verification must fail.
    const tampered = [
      { prevHash: ZERO_HASH, entryHash: entryHashes[0], payload: payloads[0] },
      { prevHash: entryHashes[0], entryHash: entryHashes[1], payload: sample({ action: 'view', metadata: 'TAMPERED' }) },
      { prevHash: entryHashes[1], entryHash: entryHashes[2], payload: payloads[2] },
    ];
    expect(verifyChain(tampered)).toBe(false);
  });

  it('detects re-ordered entries', () => {
    const payloads = [sample({ action: 'create' }), sample({ action: 'view' })];
    const { entryHashes } = replayChain(ZERO_HASH, payloads);
    const reordered = [
      // swap entries — verification must fail because prev/curr no longer chain
      { prevHash: ZERO_HASH, entryHash: entryHashes[1], payload: payloads[1] },
      { prevHash: entryHashes[1], entryHash: entryHashes[0], payload: payloads[0] },
    ];
    expect(verifyChain(reordered)).toBe(false);
  });
});
