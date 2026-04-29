/**
 * MediHive — Copyright (C) 2024-2026 The MediHive Authors
 * Licensed under the GNU Affero General Public License v3.0 or later.
 *
 * Ed25519 signature verifier using Node's built-in crypto.
 *
 * Solana wallets sign with Ed25519. Verifying a bridge signature means:
 *   1. Take the canonicalized BridgePayload bytes (UTF-8).
 *   2. Take the signature bytes (base64-decoded).
 *   3. Take the wallet's public key (base58-decoded to 32 bytes).
 *   4. Run Ed25519 verify.
 *
 * We use the standard library's `crypto.verify` rather than tweetnacl
 * to avoid pulling in another dep. Node 16+ supports the 'ed25519' alg.
 */

import { createPublicKey, verify } from 'crypto';
import { canonicalizeBridge, BridgePayload } from './bridge-canonical';
import { BridgeSignatureVerifier } from './bridge-store';

/**
 * Decode a base58-encoded Solana pubkey into 32 raw bytes.
 *
 * We avoid the bs58 dependency by inlining a minimal decoder. Pubkeys
 * are always 32 bytes encoded as exactly 43 or 44 base58 characters.
 */
function base58Decode(input: string): Buffer {
  const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
  const map: Record<string, number> = {};
  for (let i = 0; i < ALPHABET.length; i++) map[ALPHABET[i]] = i;

  // Count leading zeros (encoded as '1's in base58).
  let leadingZeros = 0;
  for (const ch of input) {
    if (ch === '1') leadingZeros++;
    else break;
  }

  const bytes: number[] = [];
  for (const ch of input) {
    if (!(ch in map)) throw new Error(`Invalid base58 char: ${ch}`);
    let carry = map[ch];
    for (let j = 0; j < bytes.length; j++) {
      carry += bytes[j] * 58;
      bytes[j] = carry & 0xff;
      carry >>= 8;
    }
    while (carry) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }

  // Reverse and prepend the leading-zero count.
  bytes.reverse();
  const result = Buffer.alloc(leadingZeros + bytes.length);
  result.fill(0, 0, leadingZeros);
  Buffer.from(bytes).copy(result, leadingZeros);
  return result;
}

/**
 * Wrap a 32-byte Ed25519 public key in a SPKI DER envelope so Node's
 * crypto.createPublicKey accepts it. Solana ships the raw 32-byte key,
 * but Node wants SPKI. The prefix is the standard ASN.1 wrapper for
 * 'algorithm: id-Ed25519, parameters: NULL'.
 */
const SPKI_ED25519_PREFIX = Buffer.from([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
]);

function ed25519PubkeyToSpki(rawPubkey: Buffer): Buffer {
  if (rawPubkey.length !== 32) {
    throw new Error(`Ed25519 pubkey must be 32 bytes, got ${rawPubkey.length}`);
  }
  return Buffer.concat([SPKI_ED25519_PREFIX, rawPubkey]);
}

export class Ed25519BridgeVerifier implements BridgeSignatureVerifier {
  verify(payload: BridgePayload, signatureB64: string, onchainPubkeyB58: string): boolean {
    try {
      const message = Buffer.from(canonicalizeBridge(payload), 'utf8');
      const signature = Buffer.from(signatureB64, 'base64');
      if (signature.length !== 64) return false;

      const rawPubkey = base58Decode(onchainPubkeyB58);
      const spki = ed25519PubkeyToSpki(rawPubkey);
      const pubkey = createPublicKey({ key: spki, format: 'der', type: 'spki' });

      return verify(null, message, pubkey, signature);
    } catch {
      // Any decode/verify error is treated as "not valid" — never throw
      // from a verifier; the store decides what to do with a `false`.
      return false;
    }
  }
}
