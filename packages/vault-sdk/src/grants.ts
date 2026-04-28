import { Connection, PublicKey } from '@solana/web3.js';
import { AccessGrant, AccessScope, GrantStatus } from './types';

export class AccessGrantsSDK {
  constructor(
    private connection: Connection,
    private programId: PublicKey
  ) {}

  /** Derive the PDA for an access grant */
  getGrantPDA(
    patient: PublicKey,
    grantee: PublicKey,
    nonce: bigint
  ): [PublicKey, number] {
    const nonceBuffer = Buffer.alloc(8);
    nonceBuffer.writeBigUInt64LE(nonce);
    return PublicKey.findProgramAddressSync(
      [Buffer.from('grant'), patient.toBuffer(), grantee.toBuffer(), nonceBuffer],
      this.programId
    );
  }

  /** Fetch an access grant */
  async getGrant(grantPDA: PublicKey): Promise<AccessGrant | null> {
    const accountInfo = await this.connection.getAccountInfo(grantPDA);
    if (!accountInfo) return null;
    return this.decodeGrant(accountInfo.data);
  }

  /** Get all active grants for a patient */
  async getPatientGrants(patient: PublicKey): Promise<AccessGrant[]> {
    const accounts = await this.connection.getProgramAccounts(this.programId, {
      filters: [
        { memcmp: { offset: 8, bytes: patient.toBase58() } },
      ],
    });
    return accounts
      .map((a) => this.decodeGrant(a.account.data))
      .filter((g) => g.status === GrantStatus.Active);
  }

  /** Get all grants a clinician has received */
  async getClinicianGrants(grantee: PublicKey): Promise<AccessGrant[]> {
    const accounts = await this.connection.getProgramAccounts(this.programId, {
      filters: [
        { memcmp: { offset: 8 + 32, bytes: grantee.toBase58() } },
      ],
    });
    return accounts
      .map((a) => this.decodeGrant(a.account.data))
      .filter((g) => g.status === GrantStatus.Active);
  }

  /** Check if a grant is currently valid */
  isGrantValid(grant: AccessGrant): boolean {
    const now = Math.floor(Date.now() / 1000);
    return (
      grant.status === GrantStatus.Active &&
      now >= grant.validFrom &&
      now <= grant.validUntil &&
      (grant.maxAccesses === null || grant.accessCount < grant.maxAccesses)
    );
  }

  /** Check if a clinician has ANY valid grant for a patient */
  async hasValidGrant(patient: PublicKey, grantee: PublicKey): Promise<boolean> {
    const grants = await this.getClinicianGrants(grantee);
    return grants.some(
      (g) => g.patient.equals(patient) && this.isGrantValid(g)
    );
  }

  /** Full Borsh decoder for AccessGrant on-chain account */
  private decodeGrant(data: Buffer): AccessGrant {
    let offset = 8; // Skip Anchor discriminator

    // patient: Pubkey (32 bytes)
    const patient = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;

    // grantee: Pubkey (32 bytes)
    const grantee = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;

    // scope: AccessScope
    // scope.record_types: Vec<u8>
    const recordTypesLen = data.readUInt32LE(offset);
    offset += 4;
    const recordTypes: number[] = [];
    for (let i = 0; i < recordTypesLen; i++) {
      recordTypes.push(data[offset]);
      offset += 1;
    }

    // scope.departments: Vec<String>
    const deptLen = data.readUInt32LE(offset);
    offset += 4;
    const departments: string[] = [];
    for (let i = 0; i < deptLen; i++) {
      const strLen = data.readUInt32LE(offset);
      offset += 4;
      departments.push(data.subarray(offset, offset + strLen).toString('utf8'));
      offset += strLen;
    }

    // scope.read: bool, scope.write: bool, scope.emergency: bool
    const read = data[offset] === 1;
    offset += 1;
    const write = data[offset] === 1;
    offset += 1;
    const emergency = data[offset] === 1;
    offset += 1;

    const scope: AccessScope = { recordTypes, departments, read, write, emergency };

    // re_encryption_key: [u8; 48]
    const reEncryptionKey = new Uint8Array(data.subarray(offset, offset + 48));
    offset += 48;

    // valid_from: i64
    const validFrom = Number(data.readBigInt64LE(offset));
    offset += 8;

    // valid_until: i64
    const validUntil = Number(data.readBigInt64LE(offset));
    offset += 8;

    // max_accesses: Option<u32>
    const hasMaxAccesses = data[offset] === 1;
    offset += 1;
    let maxAccesses: number | null = null;
    if (hasMaxAccesses) {
      maxAccesses = data.readUInt32LE(offset);
      offset += 4;
    }

    // access_count: u32
    const accessCount = data.readUInt32LE(offset);
    offset += 4;

    // status: GrantStatus (u8 enum)
    const status = data[offset] as GrantStatus;
    offset += 1;

    // grant_reason: String
    const reasonLen = data.readUInt32LE(offset);
    offset += 4;
    const grantReason = data.subarray(offset, offset + reasonLen).toString('utf8');
    offset += reasonLen;

    // nonce: u64
    const nonce = Number(data.readBigUInt64LE(offset));
    offset += 8;

    // bump: u8
    const bump = data[offset];

    return {
      patient,
      grantee,
      scope,
      reEncryptionKey,
      validFrom,
      validUntil,
      maxAccesses,
      accessCount,
      status,
      grantReason,
      nonce,
      bump,
    };
  }
}
