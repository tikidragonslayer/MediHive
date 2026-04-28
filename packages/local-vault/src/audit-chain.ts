/**
 * MediHive — Copyright (C) 2024-2026 The MediHive Authors
 * Licensed under the GNU Affero General Public License v3.0 or later.
 *
 * Hash-chained audit primitive.
 *
 * Each audit entry's hash is SHA-256(prevHash || canonical(payload)).
 * The first entry chains from the all-zero hash. Tampering anywhere in
 * the chain produces a different root from a given starting point, so
 * comparing the locally-computed root against an externally-published
 * checkpoint detects any modification — even by a database admin.
 *
 * Canonical JSON follows RFC 8785 ordering rules: keys sorted
 * lexicographically, no whitespace, numbers in shortest-round-trip form.
 */

import { createHash } from 'crypto';

export const ZERO_HASH = Buffer.alloc(32, 0);

export interface AuditPayload {
  actor: string;
  action: string;
  targetPatient: string;
  targetRecord: string | null;
  timestamp: number;
  ipHash: string; // hex
  deviceHash: string; // hex
  metadata: string;
}

/**
 * Canonicalize for hashing. We do NOT use JSON.stringify directly because
 * its output is unstable across runtimes. Instead we sort keys and emit
 * a tight format. For floating-point numbers we would need RFC 8785's
 * number serializer, but every field here is a string or integer so the
 * default toString is deterministic.
 */
export function canonicalize(payload: AuditPayload): string {
  const ordered = {
    action: payload.action,
    actor: payload.actor,
    deviceHash: payload.deviceHash,
    ipHash: payload.ipHash,
    metadata: payload.metadata,
    targetPatient: payload.targetPatient,
    targetRecord: payload.targetRecord,
    timestamp: payload.timestamp,
  };
  // Keys above are pre-sorted lexicographically. Any new field must be
  // inserted in sorted order to keep canonicalization stable.
  return JSON.stringify(ordered);
}

/**
 * Compute the entry hash given the previous chain hash and the payload.
 */
export function computeEntryHash(prevHash: Buffer, payload: AuditPayload): Buffer {
  if (prevHash.length !== 32) {
    throw new Error(`prevHash must be 32 bytes, got ${prevHash.length}`);
  }
  const canonical = canonicalize(payload);
  return createHash('sha256')
    .update(prevHash)
    .update(canonical, 'utf8')
    .digest();
}

/**
 * Replay a sequence of payloads from a starting hash and return the final
 * root hash plus the per-entry hashes. Used by verification routines.
 */
export function replayChain(
  startHash: Buffer,
  payloads: AuditPayload[],
): { entryHashes: Buffer[]; rootHash: Buffer } {
  const entryHashes: Buffer[] = [];
  let prev = startHash;
  for (const payload of payloads) {
    const entry = computeEntryHash(prev, payload);
    entryHashes.push(entry);
    prev = entry;
  }
  return { entryHashes, rootHash: prev };
}

/**
 * Verify that a sequence of (prevHash, entryHash, payload) triples forms
 * a consistent chain. Returns true iff every entry hash matches its
 * recomputed value.
 */
export function verifyChain(
  entries: { prevHash: Buffer; entryHash: Buffer; payload: AuditPayload }[],
): boolean {
  for (const e of entries) {
    const recomputed = computeEntryHash(e.prevHash, e.payload);
    if (!recomputed.equals(e.entryHash)) return false;
  }
  return true;
}

export function bufToHex(b: Buffer | Uint8Array): string {
  return Buffer.from(b).toString('hex');
}

export function hexToBuf(h: string): Buffer {
  return Buffer.from(h, 'hex');
}
