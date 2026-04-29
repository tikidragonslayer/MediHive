/**
 * MediHive — Copyright (C) 2024-2026 The MediHive Authors
 * Licensed under the GNU Affero General Public License v3.0 or later.
 *
 * Canonical JSON serialization for patient bridge signatures.
 *
 * The signed payload binds the patient's local passport id, on-chain
 * wallet, a nonce, and a timestamp. Verifying that signature against the
 * on-chain wallet's pubkey proves the same person controls both
 * identities. Canonical JSON keeps the encoding stable across runtimes.
 */

export interface BridgePayload {
  /** Local passport UUID, or null if this bridge represents a pure
   *  on-chain identity that has no local row yet. */
  localPassportId: string | null;
  /** On-chain wallet (base58), or null for pure-local bridges. */
  onchainPassportId: string | null;
  /** ≥128 bits of entropy, used to prevent replay. */
  nonce: string;
  /** Unix epoch seconds at signature time. */
  timestamp: number;
}

/**
 * Canonical JSON: keys sorted lexicographically, no whitespace.
 * Any new field MUST be inserted in sorted order to keep encoding stable
 * (an unknown field on the wrong side of an alphabetical neighbour would
 * silently invalidate every prior signature).
 */
export function canonicalizeBridge(p: BridgePayload): string {
  return JSON.stringify({
    localPassportId: p.localPassportId,
    nonce: p.nonce,
    onchainPassportId: p.onchainPassportId,
    timestamp: p.timestamp,
  });
}
