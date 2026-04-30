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

  // ============================================================
  // Transaction builders
  //
  // Anchor discriminators are sha256("global:<method_name>")[0..8].
  // Args are Borsh-encoded in the order they appear in the program's
  // instruction handler. These pure builders return a TransactionIx
  // the caller signs + sends. Tests in __tests__/passport-tx.test.ts
  // pin the discriminator + layout so future SDK refactors fail loudly
  // before constructing a real transaction.
  // ============================================================

  buildCreatePassportIx(args: {
    authority: PublicKey;
    mrnHash: Uint8Array;
    identityHash: Uint8Array;
    publicEncryptionKey: Uint8Array;
    recoveryThreshold: number;
    guardians: PublicKey[];
    emergencyHospitalShard: boolean;
  }): TransactionInstruction {
    if (args.mrnHash.length !== 32) throw new Error('mrnHash must be 32 bytes');
    if (args.identityHash.length !== 32) throw new Error('identityHash must be 32 bytes');
    if (args.publicEncryptionKey.length !== 32) throw new Error('publicEncryptionKey must be 32 bytes');
    if (args.recoveryThreshold < 1 || args.recoveryThreshold > 10) {
      throw new Error('recoveryThreshold must be 1..10');
    }
    if (args.guardians.length < args.recoveryThreshold) {
      throw new Error('guardians.length must be >= recoveryThreshold');
    }
    if (args.guardians.length > 10) {
      throw new Error('guardians cap is 10');
    }

    const [passportPda] = this.getPassportPDA(args.authority);
    const discriminator = createHash('sha256').update('global:create_passport').digest().subarray(0, 8);

    const guardianBytes = Buffer.concat(args.guardians.map((g) => g.toBuffer()));
    const guardiansLenLe = Buffer.alloc(4);
    guardiansLenLe.writeUInt32LE(args.guardians.length, 0);

    const argBuf = Buffer.concat([
      Buffer.from(args.mrnHash),
      Buffer.from(args.identityHash),
      Buffer.from(args.publicEncryptionKey),
      Buffer.from([args.recoveryThreshold & 0xff]),
      guardiansLenLe,
      guardianBytes,
      Buffer.from([args.emergencyHospitalShard ? 1 : 0]),
    ]);

    const data = Buffer.concat([discriminator, argBuf]);

    return new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: passportPda, isSigner: false, isWritable: true },
        { pubkey: args.authority, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data,
    });
  }

  buildSetPassportStatusIx(args: {
    authority: PublicKey;
    status: PassportStatus;
  }): TransactionInstruction {
    if (args.status !== 0 && args.status !== 1 && args.status !== 2) {
      throw new Error(`status must be PassportStatus enum (0..2), got ${args.status}`);
    }
    const [passportPda] = this.getPassportPDA(args.authority);
    const discriminator = createHash('sha256').update('global:set_passport_status').digest().subarray(0, 8);
    const data = Buffer.concat([discriminator, Buffer.from([args.status & 0xff])]);
    return new TransactionInstruction({
      programId: this.programId,
      keys: [
        { pubkey: passportPda, isSigner: false, isWritable: true },
        { pubkey: args.authority, isSigner: true, isWritable: false },
      ],
      data,
    });
  }

  async sendCreatePassportTx(
    payer: Keypair,
    args: Parameters<PatientPassportSDK['buildCreatePassportIx']>[0],
  ): Promise<string> {
    const ix = this.buildCreatePassportIx(args);
    const tx = new Transaction().add(ix);
    tx.feePayer = payer.publicKey;
    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(payer);
    return this.connection.sendRawTransaction(tx.serialize());
  }
}
