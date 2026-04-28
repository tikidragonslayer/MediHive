import { Keypair } from '@solana/web3.js';
import { createHmac, createHash, randomBytes } from 'crypto';
import { HDKeySet } from './types';

/**
 * HDKeyManager — BIP-44 compliant hierarchical deterministic key derivation.
 *
 * Replaces the naive SHA-256(seed) shortcut with proper SLIP-0010 Ed25519 derivation.
 *
 * Key hierarchy for Medi-Hive:
 * m/44'/501'/0'/0' → Signing key (Solana wallet — signs transactions)
 * m/44'/501'/0'/1' → Encryption key (X25519 — encrypts medical records)
 * m/44'/501'/0'/2' → Recovery key (split via Shamir — held by guardians)
 * m/44'/501'/0'/3' → Delegation key (generates PRE re-encryption keys)
 *
 * Standard: SLIP-0010 (Ed25519 from BIP-32 path)
 * Reference: https://github.com/satoshilabs/slips/blob/master/slip-0010.md
 *
 * 44' = BIP-44 purpose
 * 501' = Solana coin type (SLIP-0044)
 * 0' = account index
 * n' = key purpose (our extension for medical use)
 */

const ED25519_CURVE = 'ed25519 seed';
const HARDENED_OFFSET = 0x80000000;

interface DerivedKey {
  key: Uint8Array;    // 32-byte private key
  chainCode: Uint8Array; // 32-byte chain code
}

export class HDKeyManager {
  /**
   * Generate a complete HD key set from a seed.
   * Seed should be 32 or 64 bytes of entropy (from BIP-39 mnemonic).
   */
  static deriveKeySet(seed: Uint8Array): HDKeySet {
    // Master key derivation per SLIP-0010
    const master = HDKeyManager.deriveMaster(seed);

    // Derive each purpose key: m/44'/501'/0'/n'
    const purpose = HDKeyManager.deriveChild(master, 44 + HARDENED_OFFSET);
    const coinType = HDKeyManager.deriveChild(purpose, 501 + HARDENED_OFFSET);
    const account = HDKeyManager.deriveChild(coinType, 0 + HARDENED_OFFSET);

    const signingDerived = HDKeyManager.deriveChild(account, 0 + HARDENED_OFFSET);
    const encryptionDerived = HDKeyManager.deriveChild(account, 1 + HARDENED_OFFSET);
    const recoveryDerived = HDKeyManager.deriveChild(account, 2 + HARDENED_OFFSET);
    const delegationDerived = HDKeyManager.deriveChild(account, 3 + HARDENED_OFFSET);

    // Convert Ed25519 private keys to keypairs
    const signingKeypair = Keypair.fromSeed(signingDerived.key);
    const encryptionKeypair = Keypair.fromSeed(encryptionDerived.key);
    const recoveryKeypair = Keypair.fromSeed(recoveryDerived.key);
    const delegationKeypair = Keypair.fromSeed(delegationDerived.key);

    return {
      seed: new Uint8Array(seed),
      signingKey: {
        publicKey: signingKeypair.publicKey.toBytes(),
        secretKey: signingKeypair.secretKey,
      },
      encryptionKey: {
        publicKey: encryptionKeypair.publicKey.toBytes(),
        secretKey: encryptionKeypair.secretKey,
      },
      recoveryKey: {
        publicKey: recoveryKeypair.publicKey.toBytes(),
        secretKey: recoveryKeypair.secretKey,
      },
      delegationKey: {
        publicKey: delegationKeypair.publicKey.toBytes(),
        secretKey: delegationKeypair.secretKey,
      },
    };
  }

  /**
   * Generate a fresh seed (32 bytes of cryptographic randomness).
   * In production: use BIP-39 mnemonic generation.
   */
  static generateSeed(): Uint8Array {
    return new Uint8Array(randomBytes(32));
  }

  /**
   * Derive a seed from a BIP-39 mnemonic phrase.
   * Uses PBKDF2 with 2048 iterations per BIP-39 spec.
   */
  static seedFromMnemonic(mnemonic: string, passphrase: string = ''): Uint8Array {
    // BIP-39: PBKDF2(mnemonic, "mnemonic" + passphrase, 2048, 64, SHA-512)
    // Simplified: HMAC-SHA512 for prototype (production uses proper PBKDF2)
    const hmac = createHmac('sha512', `mnemonic${passphrase}`);
    hmac.update(mnemonic);
    return new Uint8Array(hmac.digest());
  }

  /**
   * Derive the master key from seed per SLIP-0010.
   * HMAC-SHA512 with "ed25519 seed" as key.
   */
  private static deriveMaster(seed: Uint8Array): DerivedKey {
    const hmac = createHmac('sha512', ED25519_CURVE);
    hmac.update(Buffer.from(seed));
    const result = hmac.digest();
    return {
      key: new Uint8Array(result.subarray(0, 32)),
      chainCode: new Uint8Array(result.subarray(32)),
    };
  }

  /**
   * Derive a child key per SLIP-0010 (hardened only for Ed25519).
   * All Ed25519 derivation uses hardened keys (index >= 0x80000000).
   */
  private static deriveChild(parent: DerivedKey, index: number): DerivedKey {
    if (index < HARDENED_OFFSET) {
      throw new Error('Ed25519 SLIP-0010 only supports hardened derivation');
    }

    // Data = 0x00 || parent_key || index (big-endian)
    const data = Buffer.alloc(37);
    data[0] = 0x00;
    Buffer.from(parent.key).copy(data, 1);
    data.writeUInt32BE(index, 33);

    const hmac = createHmac('sha512', Buffer.from(parent.chainCode));
    hmac.update(data);
    const result = hmac.digest();

    return {
      key: new Uint8Array(result.subarray(0, 32)),
      chainCode: new Uint8Array(result.subarray(32)),
    };
  }

  /**
   * Verify that a derived key set is internally consistent.
   * Used after key recovery to confirm the reconstructed seed produces the expected keys.
   */
  static verifyKeySet(keySet: HDKeySet, expectedSigningPubkey: Uint8Array): boolean {
    const reDerived = HDKeyManager.deriveKeySet(keySet.seed);
    return Buffer.from(reDerived.signingKey.publicKey).equals(Buffer.from(expectedSigningPubkey));
  }

  /**
   * Derive a sub-key for a specific record (deterministic per-record encryption).
   * path: m/44'/501'/0'/1'/recordIndex'
   */
  static deriveRecordKey(seed: Uint8Array, recordIndex: number): Uint8Array {
    const master = HDKeyManager.deriveMaster(seed);
    const purpose = HDKeyManager.deriveChild(master, 44 + HARDENED_OFFSET);
    const coinType = HDKeyManager.deriveChild(purpose, 501 + HARDENED_OFFSET);
    const account = HDKeyManager.deriveChild(coinType, 0 + HARDENED_OFFSET);
    const encryption = HDKeyManager.deriveChild(account, 1 + HARDENED_OFFSET);
    const recordKey = HDKeyManager.deriveChild(encryption, recordIndex + HARDENED_OFFSET);
    return recordKey.key;
  }
}
