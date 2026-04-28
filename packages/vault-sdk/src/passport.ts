import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  SystemProgram,
} from '@solana/web3.js';
import { PatientPassport, PassportStatus } from './types';
import { createHash } from 'crypto';

export class PatientPassportSDK {
  constructor(
    private connection: Connection,
    private programId: PublicKey
  ) {}

  /** Derive the PDA for a patient passport */
  getPassportPDA(patientWallet: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('passport'), patientWallet.toBuffer()],
      this.programId
    );
  }

  /** Hash patient identity data for on-chain storage */
  static hashIdentity(name: string, dob: string, ssn4: string): Uint8Array {
    const hash = createHash('sha256');
    hash.update(`${name.toLowerCase()}:${dob}:${ssn4}`);
    return new Uint8Array(hash.digest());
  }

  /** Hash MRN for on-chain storage */
  static hashMRN(mrn: string): Uint8Array {
    const hash = createHash('sha256');
    hash.update(mrn);
    return new Uint8Array(hash.digest());
  }

  /** Fetch a patient passport account */
  async getPassport(patientWallet: PublicKey): Promise<PatientPassport | null> {
    const [pda] = this.getPassportPDA(patientWallet);
    const accountInfo = await this.connection.getAccountInfo(pda);
    if (!accountInfo) return null;

    // Decode account data (Anchor discriminator + borsh-serialized data)
    // In production, use Anchor's Program.account.patientPassport.fetch()
    return this.decodePassport(accountInfo.data);
  }

  /** Check if a patient passport exists */
  async passportExists(patientWallet: PublicKey): Promise<boolean> {
    const [pda] = this.getPassportPDA(patientWallet);
    const accountInfo = await this.connection.getAccountInfo(pda);
    return accountInfo !== null;
  }

  private decodePassport(data: Buffer): PatientPassport {
    // Skip 8-byte Anchor discriminator
    let offset = 8;

    const authority = new PublicKey(data.subarray(offset, offset + 32));
    offset += 32;

    const mrnHash = new Uint8Array(data.subarray(offset, offset + 32));
    offset += 32;

    const identityHash = new Uint8Array(data.subarray(offset, offset + 32));
    offset += 32;

    const publicEncryptionKey = new Uint8Array(data.subarray(offset, offset + 32));
    offset += 32;

    const recoveryThreshold = data[offset];
    offset += 1;

    const guardiansLen = data.readUInt32LE(offset);
    offset += 4;
    const guardians: PublicKey[] = [];
    for (let i = 0; i < guardiansLen; i++) {
      guardians.push(new PublicKey(data.subarray(offset, offset + 32)));
      offset += 32;
    }

    const emergencyHospitalShard = data[offset] === 1;
    offset += 1;

    const createdAt = Number(data.readBigInt64LE(offset));
    offset += 8;

    const status = data[offset] as PassportStatus;
    offset += 1;

    const bump = data[offset];

    return {
      authority,
      mrnHash,
      identityHash,
      publicEncryptionKey,
      recoveryThreshold,
      guardians,
      emergencyHospitalShard,
      createdAt,
      status,
      bump,
    };
  }
}
