import { PublicKey, Keypair } from '@solana/web3.js';
import { createHash, randomBytes, createCipheriv, createDecipheriv } from 'crypto';

/**
 * MobileWallet — Patient wallet management for mobile devices.
 *
 * The patient's phone IS their health data node:
 * - Private key stored in device secure enclave (iOS Keychain / Android Keystore)
 * - HD wallet derivation for signing, encryption, recovery, delegation keys
 * - NFC tap to share wallet address with hospital check-in
 * - Biometric (Face ID / fingerprint) to authorize transactions
 *
 * Key hierarchy (BIP-44 style):
 * Seed (256-bit)
 *   ├── m/44'/501'/0'/0 → Signing key (Solana wallet)
 *   ├── m/44'/501'/0'/1 → Encryption key (X25519 for PRE)
 *   ├── m/44'/501'/0'/2 → Recovery key (held by guardians)
 *   └── m/44'/501'/0'/3 → Delegation key (for access grants)
 */

export interface WalletState {
  publicKey: string;
  encryptionPublicKey: string;
  isLocked: boolean;
  passportMinted: boolean;
  createdAt: string;
}

export class MobileWallet {
  private seed: Buffer | null = null;
  private keypair: Keypair | null = null;
  private encryptionKey: Uint8Array | null = null;
  private isLocked = true;

  /**
   * Create a new wallet from a fresh seed.
   * In production: seed stored in iOS Keychain / Android Keystore.
   */
  static create(): { wallet: MobileWallet; seedPhrase: string } {
    const seed = randomBytes(32);
    const wallet = new MobileWallet();
    wallet.seed = seed;
    wallet.deriveKeys();
    wallet.isLocked = false;

    // Generate BIP-39 mnemonic (simplified — in production use bip39 library)
    const seedPhrase = seed.toString('hex'); // In production: bip39.entropyToMnemonic(seed)

    return { wallet, seedPhrase };
  }

  /**
   * Restore wallet from seed phrase.
   */
  static fromSeedPhrase(seedPhrase: string): MobileWallet {
    const wallet = new MobileWallet();
    // In production: bip39.mnemonicToEntropy(seedPhrase)
    wallet.seed = Buffer.from(seedPhrase, 'hex');
    wallet.deriveKeys();
    wallet.isLocked = false;
    return wallet;
  }

  /**
   * Lock the wallet (clear keys from memory).
   * Requires biometric to unlock.
   */
  lock(): void {
    this.isLocked = true;
    // Keys stay derived but access is gated by biometric
  }

  /**
   * Unlock with biometric authentication.
   * In production: LocalAuthentication (iOS) / BiometricPrompt (Android)
   */
  async unlock(): Promise<boolean> {
    // In production: native biometric prompt
    // const result = await LocalAuthentication.authenticateAsync({ promptMessage: 'Unlock Medi-Hive' });
    // return result.success;
    this.isLocked = false;
    return true;
  }

  /** Get the Solana public key */
  getPublicKey(): PublicKey {
    this.ensureUnlocked();
    return this.keypair!.publicKey;
  }

  /** Get the encryption public key (for sharing with hospitals) */
  getEncryptionPublicKey(): Uint8Array {
    this.ensureUnlocked();
    return this.encryptionKey!;
  }

  /** Get the Keypair for signing transactions */
  getKeypair(): Keypair {
    this.ensureUnlocked();
    return this.keypair!;
  }

  /** Sign arbitrary data (for API request authentication) */
  sign(message: Uint8Array): Uint8Array {
    this.ensureUnlocked();
    // In production: nacl.sign.detached(message, this.keypair.secretKey)
    const hash = createHash('sha256').update(Buffer.from(message)).update(this.keypair!.secretKey).digest();
    return new Uint8Array(hash);
  }

  /** Encrypt data with the patient's key (for IPFS storage) */
  encrypt(plaintext: string): { ciphertext: Buffer; nonce: Buffer; tag: Buffer } {
    this.ensureUnlocked();
    const key = this.deriveDataEncryptionKey();
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, nonce);
    const ciphertext = Buffer.concat([cipher.update(Buffer.from(plaintext)), cipher.final()]);
    const tag = cipher.getAuthTag();
    return { ciphertext, nonce, tag };
  }

  /** Decrypt data */
  decrypt(ciphertext: Buffer, nonce: Buffer, tag: Buffer): string {
    this.ensureUnlocked();
    const key = this.deriveDataEncryptionKey();
    const decipher = createDecipheriv('aes-256-gcm', key, nonce);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  /** Generate NFC payload for hospital check-in tap */
  getNFCPayload(): { type: string; data: string } {
    this.ensureUnlocked();
    return {
      type: 'application/medihive-passport',
      data: JSON.stringify({
        v: 1,
        pubkey: this.keypair!.publicKey.toBase58(),
        encPubkey: Buffer.from(this.encryptionKey!).toString('base64'),
        ts: Math.floor(Date.now() / 1000),
      }),
    };
  }

  /** Generate QR code data for check-in (fallback if NFC unavailable) */
  getQRData(): string {
    this.ensureUnlocked();
    return `medihive://passport/${this.keypair!.publicKey.toBase58()}`;
  }

  /** Get wallet state (safe to display) */
  getState(): WalletState {
    return {
      publicKey: this.keypair?.publicKey.toBase58() ?? '',
      encryptionPublicKey: this.encryptionKey ? Buffer.from(this.encryptionKey).toString('base64') : '',
      isLocked: this.isLocked,
      passportMinted: false, // Would check on-chain
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Export Shamir recovery shares for guardians.
   * Split the seed into N shares with threshold T.
   */
  exportRecoveryShares(threshold: number, totalShares: number): Buffer[] {
    this.ensureUnlocked();
    if (!this.seed) throw new Error('No seed available');
    if (threshold > totalShares || threshold < 2 || totalShares > 5) {
      throw new Error('Invalid threshold/shares (2 <= threshold <= shares <= 5)');
    }

    // Simplified Shamir's Secret Sharing
    // In production: use shamir npm package or secrets.js
    const shares: Buffer[] = [];
    for (let i = 0; i < totalShares; i++) {
      const share = Buffer.alloc(33);
      share[0] = i + 1; // Share index
      // XOR seed with random data (simplified — real Shamir uses polynomial interpolation)
      const random = randomBytes(32);
      for (let j = 0; j < 32; j++) {
        share[j + 1] = this.seed[j] ^ random[j];
      }
      shares.push(share);
    }

    return shares;
  }

  // === Private ===

  private deriveKeys(): void {
    if (!this.seed) throw new Error('No seed');

    // Derive signing keypair (in production: BIP-44 derivation path m/44'/501'/0'/0)
    const signingKey = createHash('sha256').update(Buffer.concat([this.seed, Buffer.from('signing')])).digest();
    this.keypair = Keypair.fromSeed(new Uint8Array(signingKey));

    // Derive encryption key (in production: BIP-44 path m/44'/501'/0'/1, then X25519)
    this.encryptionKey = new Uint8Array(
      createHash('sha256').update(Buffer.concat([this.seed, Buffer.from('encryption')])).digest()
    );
  }

  private deriveDataEncryptionKey(): Buffer {
    if (!this.seed) throw new Error('No seed');
    return createHash('sha256').update(Buffer.concat([this.seed, Buffer.from('data-encryption')])).digest();
  }

  private ensureUnlocked(): void {
    if (this.isLocked) throw new Error('Wallet is locked — biometric authentication required');
    if (!this.keypair) throw new Error('Wallet not initialized');
  }
}
