export interface HDKeySet {
  /** Master seed (NEVER expose — stored in secure enclave only) */
  seed: Uint8Array;
  /** m/44'/501'/0'/0 — Solana signing keypair */
  signingKey: { publicKey: Uint8Array; secretKey: Uint8Array };
  /** m/44'/501'/0'/1 — X25519 encryption keypair */
  encryptionKey: { publicKey: Uint8Array; secretKey: Uint8Array };
  /** m/44'/501'/0'/2 — Recovery key (split via Shamir) */
  recoveryKey: { publicKey: Uint8Array; secretKey: Uint8Array };
  /** m/44'/501'/0'/3 — Delegation key (for PRE re-encryption key generation) */
  delegationKey: { publicKey: Uint8Array; secretKey: Uint8Array };
}

export interface ShamirShare {
  index: number;  // 1-based share index
  data: Uint8Array;
  threshold: number;
  totalShares: number;
  createdAt: string;
  holderLabel: string;  // "patient", "hospital", "family_member", "attorney", "escrow"
}

export interface RecoveryConfig {
  threshold: number;
  totalShares: number;
  shares: ShamirShare[];
  lastVerified?: string;
}

export interface ProxyReEncryptionKey {
  /** Re-encryption key: transforms ciphertext from delegator to delegatee */
  reKey: Uint8Array;
  /** Who delegated access */
  delegatorPubkey: Uint8Array;
  /** Who receives access */
  delegateePubkey: Uint8Array;
  /** Expiry timestamp */
  expiresAt: number;
  /** Scope of access */
  scope: string;
}

export interface EncryptedPayload {
  version: number;
  algorithm: string;
  ciphertext: Uint8Array;
  nonce: Uint8Array;
  tag: Uint8Array;
  /** Ephemeral public key used in encryption (for PRE compatibility) */
  ephemeralPubkey?: Uint8Array;
}
