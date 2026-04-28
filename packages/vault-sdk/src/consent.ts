import { Connection, PublicKey } from '@solana/web3.js';
import { ConsentRecord, ConsentType, ConsentMethod } from './types';

export class ConsentRegistrySDK {
  constructor(
    private connection: Connection,
    private programId: PublicKey
  ) {}

  /** Derive PDA for a consent record */
  getConsentPDA(
    patient: PublicKey,
    consentType: ConsentType,
    nonce: bigint
  ): [PublicKey, number] {
    const nonceBuffer = Buffer.alloc(8);
    nonceBuffer.writeBigUInt64LE(nonce);
    return PublicKey.findProgramAddressSync(
      [
        Buffer.from('consent'),
        patient.toBuffer(),
        Buffer.from([consentType]),
        nonceBuffer,
      ],
      this.programId
    );
  }

  /** Fetch a consent record */
  async getConsent(consentPDA: PublicKey): Promise<ConsentRecord | null> {
    const accountInfo = await this.connection.getAccountInfo(consentPDA);
    if (!accountInfo) return null;
    return this.decodeConsent(accountInfo.data);
  }

  /** Check if a specific consent type is active for a patient */
  async isConsentActive(
    patient: PublicKey,
    consentType: ConsentType
  ): Promise<boolean> {
    const consents = await this.getPatientConsents(patient);
    const now = Math.floor(Date.now() / 1000);
    return consents.some(
      (c) =>
        c.consentType === consentType &&
        c.revokedAt === null &&
        now >= c.validFrom &&
        (c.validUntil === null || now <= c.validUntil)
    );
  }

  /** Get all consent records for a patient */
  async getPatientConsents(patient: PublicKey): Promise<ConsentRecord[]> {
    const accounts = await this.connection.getProgramAccounts(this.programId, {
      filters: [
        { memcmp: { offset: 8, bytes: patient.toBase58() } },
      ],
    });
    return accounts.map((a) => this.decodeConsent(a.account.data));
  }

  /** Get all active (non-revoked, non-expired) consents for a patient */
  async getActiveConsents(patient: PublicKey): Promise<ConsentRecord[]> {
    const all = await this.getPatientConsents(patient);
    const now = Math.floor(Date.now() / 1000);
    return all.filter(
      (c) =>
        c.revokedAt === null &&
        now >= c.validFrom &&
        (c.validUntil === null || now <= c.validUntil)
    );
  }

  /** Full Borsh decoder for ConsentRecord on-chain account */
  private decodeConsent(data: Buffer): ConsentRecord {
    let offset = 8; // Skip Anchor discriminator

    // patient: Pubkey (32 bytes)
    const patient = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;

    // consent_type: ConsentType (u8 enum)
    const consentType = data[offset] as ConsentType;
    offset += 1;

    // scope: String
    const scopeLen = data.readUInt32LE(offset);
    offset += 4;
    const scope = data.subarray(offset, offset + scopeLen).toString('utf8');
    offset += scopeLen;

    // granted_to: Option<Pubkey>
    const hasGrantedTo = data[offset] === 1;
    offset += 1;
    let grantedTo: PublicKey | null = null;
    if (hasGrantedTo) {
      grantedTo = new PublicKey(data.subarray(offset, offset + 32));
      offset += 32;
    }

    // valid_from: i64
    const validFrom = Number(data.readBigInt64LE(offset));
    offset += 8;

    // valid_until: Option<i64>
    const hasValidUntil = data[offset] === 1;
    offset += 1;
    let validUntil: number | null = null;
    if (hasValidUntil) {
      validUntil = Number(data.readBigInt64LE(offset));
      offset += 8;
    }

    // revoked_at: Option<i64>
    const hasRevokedAt = data[offset] === 1;
    offset += 1;
    let revokedAt: number | null = null;
    if (hasRevokedAt) {
      revokedAt = Number(data.readBigInt64LE(offset));
      offset += 8;
    }

    // witness: Option<Pubkey>
    const hasWitness = data[offset] === 1;
    offset += 1;
    let witness: PublicKey | null = null;
    if (hasWitness) {
      witness = new PublicKey(data.subarray(offset, offset + 32));
      offset += 32;
    }

    // method: ConsentMethod (u8 enum)
    const method = data[offset] as ConsentMethod;
    offset += 1;

    // nonce: u64
    const nonce = Number(data.readBigUInt64LE(offset));
    offset += 8;

    // bump: u8
    const bump = data[offset];

    return {
      patient,
      consentType,
      scope,
      grantedTo,
      validFrom,
      validUntil,
      revokedAt,
      witness,
      method,
      nonce,
      bump,
    };
  }
}
