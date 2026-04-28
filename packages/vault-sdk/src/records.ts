import { Connection, PublicKey } from '@solana/web3.js';
import { MedicalRecord, RecordType, RecordStatus } from './types';

export class RecordManagerSDK {
  constructor(
    private connection: Connection,
    private programId: PublicKey
  ) {}

  /** Derive the PDA for a medical record */
  getRecordPDA(
    patientPassport: PublicKey,
    contentHash: Uint8Array
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('record'), patientPassport.toBuffer(), Buffer.from(contentHash)],
      this.programId
    );
  }

  /** Fetch a medical record by PDA */
  async getRecord(recordPDA: PublicKey): Promise<MedicalRecord | null> {
    const accountInfo = await this.connection.getAccountInfo(recordPDA);
    if (!accountInfo) return null;
    return this.decodeRecord(accountInfo.data);
  }

  /** Get all records for a patient by scanning accounts */
  async getPatientRecords(patientPassport: PublicKey): Promise<MedicalRecord[]> {
    const accounts = await this.connection.getProgramAccounts(this.programId, {
      filters: [
        { memcmp: { offset: 8, bytes: patientPassport.toBase58() } },
      ],
    });
    return accounts.map((a) => this.decodeRecord(a.account.data));
  }

  private decodeRecord(data: Buffer): MedicalRecord {
    let offset = 8; // Skip discriminator

    const patientPassport = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;

    const recordType = data[offset] as RecordType;
    offset += 1;

    const contentHash = new Uint8Array(data.subarray(offset, offset + 32));
    offset += 32;

    const ipfsCidLen = data.readUInt32LE(offset);
    offset += 4;
    const ipfsCid = data.subarray(offset, offset + ipfsCidLen).toString('utf8');
    offset += ipfsCidLen;

    const hasArweave = data[offset] === 1;
    offset += 1;
    let arweaveTx: string | null = null;
    if (hasArweave) {
      const txLen = data.readUInt32LE(offset);
      offset += 4;
      arweaveTx = data.subarray(offset, offset + txLen).toString('utf8');
      offset += txLen;
    }

    const abePolicyLen = data.readUInt32LE(offset);
    offset += 4;
    const abePolicy = data.subarray(offset, offset + abePolicyLen).toString('utf8');
    offset += abePolicyLen;

    const author = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;

    const authorCredentialHash = new Uint8Array(data.subarray(offset, offset + 32));
    offset += 32;

    const icdCodesHash = new Uint8Array(data.subarray(offset, offset + 32));
    offset += 32;

    const createdAt = Number(data.readBigInt64LE(offset));
    offset += 8;

    const status = data[offset] as RecordStatus;
    offset += 1;

    const hasSupersedes = data[offset] === 1;
    offset += 1;
    const supersedes = hasSupersedes
      ? new PublicKey(data.subarray(offset, offset + 32))
      : null;
    if (hasSupersedes) offset += 32;

    const bump = data[offset];

    return {
      patientPassport,
      recordType,
      contentHash,
      ipfsCid,
      arweaveTx,
      abePolicy,
      author,
      authorCredentialHash,
      icdCodesHash,
      createdAt,
      status,
      supersedes,
      bump,
    };
  }
}
