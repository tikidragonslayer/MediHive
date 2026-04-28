import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

/**
 * MediEncryption — AES-256-GCM encryption for medical records.
 *
 * In the full system, this will be augmented with:
 * - Proxy Re-Encryption (NuCypher/Umbral) for delegated access
 * - Attribute-Based Encryption (CP-ABE) for role-scoped access
 * - Zero-Knowledge Proofs for verification without disclosure
 *
 * For the prototype, we use standard AES-256-GCM which satisfies HIPAA encryption requirements.
 */
export class MediEncryption {
  /**
   * Encrypt a FHIR bundle (or any data) with AES-256-GCM.
   * Returns the ciphertext, nonce, and content hash.
   */
  static encrypt(
    plaintext: string | Buffer,
    encryptionKey: Uint8Array
  ): { ciphertext: Buffer; nonce: Buffer; tag: Buffer; contentHash: Buffer } {
    const data = typeof plaintext === 'string' ? Buffer.from(plaintext, 'utf8') : plaintext;
    const nonce = randomBytes(12); // 96-bit nonce for GCM
    const cipher = createCipheriv('aes-256-gcm', encryptionKey, nonce);

    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();

    // SHA-256 hash of the plaintext for on-chain integrity verification
    const contentHash = createHash('sha256').update(data).digest();

    return { ciphertext: encrypted, nonce, tag, contentHash };
  }

  /**
   * Decrypt an AES-256-GCM encrypted record.
   */
  static decrypt(
    ciphertext: Buffer,
    encryptionKey: Uint8Array,
    nonce: Buffer,
    tag: Buffer
  ): Buffer {
    const decipher = createDecipheriv('aes-256-gcm', encryptionKey, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  }

  /**
   * Generate a random 256-bit encryption key.
   */
  static generateKey(): Uint8Array {
    return new Uint8Array(randomBytes(32));
  }

  /**
   * Derive an encryption key from a seed phrase using PBKDF2-like derivation.
   * For the prototype — in production, use proper BIP-44 HD key derivation.
   */
  static deriveKeyFromSeed(seed: string, salt: string = 'medi-hive-v1'): Uint8Array {
    const hash = createHash('sha256');
    hash.update(`${seed}:${salt}`);
    return new Uint8Array(hash.digest());
  }

  /**
   * Hash content for on-chain storage (SHA-256).
   */
  static contentHash(data: string | Buffer): Uint8Array {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf8') : data;
    return new Uint8Array(createHash('sha256').update(buf).digest());
  }

  /**
   * Verify content integrity against a stored hash.
   */
  static verifyHash(data: string | Buffer, expectedHash: Uint8Array): boolean {
    const actualHash = MediEncryption.contentHash(data);
    return Buffer.from(actualHash).equals(Buffer.from(expectedHash));
  }

  /**
   * Package encrypted data for IPFS storage.
   * Returns a JSON-serializable object containing all decryption metadata.
   */
  static packageForIPFS(
    plaintext: string,
    encryptionKey: Uint8Array
  ): { encryptedPayload: string; contentHash: string } {
    const { ciphertext, nonce, tag, contentHash } = MediEncryption.encrypt(
      plaintext,
      encryptionKey
    );

    const payload = {
      v: 1, // version
      alg: 'AES-256-GCM',
      ct: ciphertext.toString('base64'),
      nonce: nonce.toString('base64'),
      tag: tag.toString('base64'),
    };

    return {
      encryptedPayload: JSON.stringify(payload),
      contentHash: contentHash.toString('hex'),
    };
  }

  /**
   * Unpackage and decrypt data retrieved from IPFS.
   */
  static unpackageFromIPFS(
    encryptedPayload: string,
    encryptionKey: Uint8Array
  ): string {
    const payload = JSON.parse(encryptedPayload);

    if (payload.v !== 1 || payload.alg !== 'AES-256-GCM') {
      throw new Error(`Unsupported encryption format: v${payload.v} ${payload.alg}`);
    }

    const ciphertext = Buffer.from(payload.ct, 'base64');
    const nonce = Buffer.from(payload.nonce, 'base64');
    const tag = Buffer.from(payload.tag, 'base64');

    return MediEncryption.decrypt(ciphertext, encryptionKey, nonce, tag).toString('utf8');
  }
}
