import {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  SYSVAR_CLOCK_PUBKEY,
} from '@solana/web3.js';
import { createHash } from 'crypto';
import { RecordType, ConsentType, ConsentMethod, AuditAction } from './types';

/**
 * Transaction instruction builders for all 5 MediVault programs.
 * These construct the actual Solana transactions that the SDK was missing.
 *
 * Each builder returns a TransactionInstruction that can be added to a Transaction,
 * signed by the appropriate authority, and sent to the network.
 *
 * Anchor discriminators are SHA-256("global:<instruction_name>")[0..8]
 */

// === Anchor Discriminator Helper ===

function anchorDiscriminator(instructionName: string): Buffer {
  const hash = createHash('sha256')
    .update(`global:${instructionName}`)
    .digest();
  return Buffer.from(hash.subarray(0, 8));
}

function encodeString(str: string): Buffer {
  const strBuf = Buffer.from(str, 'utf8');
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(strBuf.length);
  return Buffer.concat([lenBuf, strBuf]);
}

function encodeVecPubkey(keys: PublicKey[]): Buffer {
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32LE(keys.length);
  return Buffer.concat([lenBuf, ...keys.map((k) => k.toBuffer())]);
}

function encodeU8(val: number): Buffer {
  return Buffer.from([val]);
}

function encodeI64(val: number | bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigInt64LE(BigInt(val));
  return buf;
}

function encodeU64(val: number | bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(BigInt(val));
  return buf;
}

function encodeOption<T>(val: T | null, encoder: (v: T) => Buffer): Buffer {
  if (val === null || val === undefined) return Buffer.from([0]);
  return Buffer.concat([Buffer.from([1]), encoder(val)]);
}

function encodeU32(val: number): Buffer {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(val);
  return buf;
}

function encodeBytes32(arr: Uint8Array): Buffer {
  return Buffer.from(arr.subarray(0, 32));
}

function encodeBytes48(arr: Uint8Array): Buffer {
  return Buffer.from(arr.subarray(0, 48));
}

function encodeBool(val: boolean): Buffer {
  return Buffer.from([val ? 1 : 0]);
}

// === Patient Passport Builders ===

export class PassportBuilder {
  constructor(private programId: PublicKey) {}

  /** Build instruction to initialize a patient passport (SBT) */
  initializePassport(params: {
    patient: PublicKey;
    mrnHash: Uint8Array;
    identityHash: Uint8Array;
    publicEncryptionKey: Uint8Array;
    recoveryThreshold: number;
    guardians: PublicKey[];
  }): TransactionInstruction {
    const [passportPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('passport'), params.patient.toBuffer()],
      this.programId
    );

    const data = Buffer.concat([
      anchorDiscriminator('initialize_passport'),
      encodeBytes32(params.mrnHash),
      encodeBytes32(params.identityHash),
      encodeBytes32(params.publicEncryptionKey),
      encodeU8(params.recoveryThreshold),
      encodeVecPubkey(params.guardians),
    ]);

    return new TransactionInstruction({
      keys: [
        { pubkey: params.patient, isSigner: true, isWritable: true },
        { pubkey: passportPDA, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: this.programId,
      data,
    });
  }

  /** Build instruction to rotate encryption key */
  updateEncryptionKey(params: {
    patient: PublicKey;
    newKey: Uint8Array;
  }): TransactionInstruction {
    const [passportPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('passport'), params.patient.toBuffer()],
      this.programId
    );

    const data = Buffer.concat([
      anchorDiscriminator('update_encryption_key'),
      encodeBytes32(params.newKey),
    ]);

    return new TransactionInstruction({
      keys: [
        { pubkey: params.patient, isSigner: true, isWritable: false },
        { pubkey: passportPDA, isSigner: false, isWritable: true },
      ],
      programId: this.programId,
      data,
    });
  }

  suspendPassport(patient: PublicKey): TransactionInstruction {
    const [passportPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('passport'), patient.toBuffer()],
      this.programId
    );
    return new TransactionInstruction({
      keys: [
        { pubkey: patient, isSigner: true, isWritable: false },
        { pubkey: passportPDA, isSigner: false, isWritable: true },
      ],
      programId: this.programId,
      data: anchorDiscriminator('suspend_passport'),
    });
  }

  reactivatePassport(patient: PublicKey): TransactionInstruction {
    const [passportPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('passport'), patient.toBuffer()],
      this.programId
    );
    return new TransactionInstruction({
      keys: [
        { pubkey: patient, isSigner: true, isWritable: false },
        { pubkey: passportPDA, isSigner: false, isWritable: true },
      ],
      programId: this.programId,
      data: anchorDiscriminator('reactivate_passport'),
    });
  }
}

// === Record Manager Builders ===

export class RecordBuilder {
  constructor(private programId: PublicKey) {}

  /** Mint a new medical record NFT */
  mintRecord(params: {
    author: PublicKey;
    patientPassport: PublicKey;
    recordType: RecordType;
    contentHash: Uint8Array;
    ipfsCid: string;
    abePolicy: string;
    icdCodesHash: Uint8Array;
  }): TransactionInstruction {
    const [recordPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('record'), params.patientPassport.toBuffer(), Buffer.from(params.contentHash)],
      this.programId
    );

    const data = Buffer.concat([
      anchorDiscriminator('mint_record'),
      encodeU8(params.recordType),
      encodeBytes32(params.contentHash),
      encodeString(params.ipfsCid),
      encodeString(params.abePolicy),
      encodeBytes32(params.icdCodesHash),
    ]);

    return new TransactionInstruction({
      keys: [
        { pubkey: params.author, isSigner: true, isWritable: true },
        { pubkey: params.patientPassport, isSigner: false, isWritable: false },
        { pubkey: recordPDA, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: this.programId,
      data,
    });
  }

  /** Void a record (HIPAA-compliant, never deleted) */
  voidRecord(params: {
    author: PublicKey;
    record: PublicKey;
    reason: string;
  }): TransactionInstruction {
    const data = Buffer.concat([
      anchorDiscriminator('void_record'),
      encodeString(params.reason),
    ]);

    return new TransactionInstruction({
      keys: [
        { pubkey: params.author, isSigner: true, isWritable: false },
        { pubkey: params.record, isSigner: false, isWritable: true },
      ],
      programId: this.programId,
      data,
    });
  }
}

// === Access Grant Builders ===

export class GrantBuilder {
  constructor(private programId: PublicKey) {}

  /** Create an access grant (patient → clinician) */
  createGrant(params: {
    patient: PublicKey;
    grantee: PublicKey;
    recordTypes: number[];
    departments: string[];
    read: boolean;
    write: boolean;
    reEncryptionKey: Uint8Array;
    durationSeconds: number;
    maxAccesses: number | null;
    reason: string;
    nonce: bigint;
  }): TransactionInstruction {
    const nonceBuffer = Buffer.alloc(8);
    nonceBuffer.writeBigUInt64LE(params.nonce);

    const [grantPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('grant'), params.patient.toBuffer(), params.grantee.toBuffer(), nonceBuffer],
      this.programId
    );

    // Encode AccessScope
    const scopeData = Buffer.concat([
      encodeU32(params.recordTypes.length),
      Buffer.from(params.recordTypes),
      encodeU32(params.departments.length),
      ...params.departments.map((d) => encodeString(d)),
      encodeBool(params.read),
      encodeBool(params.write),
      encodeBool(false), // emergency = false for normal grants
    ]);

    const data = Buffer.concat([
      anchorDiscriminator('create_grant'),
      scopeData,
      encodeBytes48(params.reEncryptionKey),
      encodeI64(params.durationSeconds),
      encodeOption(params.maxAccesses, (v) => encodeU32(v)),
      encodeString(params.reason),
      encodeU64(params.nonce),
    ]);

    return new TransactionInstruction({
      keys: [
        { pubkey: params.patient, isSigner: true, isWritable: true },
        { pubkey: params.grantee, isSigner: false, isWritable: false },
        { pubkey: grantPDA, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: this.programId,
      data,
    });
  }

  /** Use a grant (clinician accessing records) */
  useGrant(params: {
    grantee: PublicKey;
    grant: PublicKey;
  }): TransactionInstruction {
    return new TransactionInstruction({
      keys: [
        { pubkey: params.grantee, isSigner: true, isWritable: false },
        { pubkey: params.grant, isSigner: false, isWritable: true },
      ],
      programId: this.programId,
      data: anchorDiscriminator('use_grant'),
    });
  }

  /** Revoke a grant (patient-initiated) */
  revokeGrant(params: {
    patient: PublicKey;
    grant: PublicKey;
  }): TransactionInstruction {
    return new TransactionInstruction({
      keys: [
        { pubkey: params.patient, isSigner: true, isWritable: false },
        { pubkey: params.grant, isSigner: false, isWritable: true },
      ],
      programId: this.programId,
      data: anchorDiscriminator('revoke_grant'),
    });
  }

  /** Emergency grant (dual-auth: clinician + supervisor) */
  emergencyGrant(params: {
    clinician: PublicKey;
    supervisor: PublicKey;
    patientPassport: PublicKey;
    reEncryptionKey: Uint8Array;
    reason: string;
  }): TransactionInstruction {
    // Emergency grants use timestamp as nonce
    const now = BigInt(Math.floor(Date.now() / 1000));
    const nonceBuffer = Buffer.alloc(8);
    nonceBuffer.writeBigInt64LE(now);

    const [grantPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('grant'), params.patientPassport.toBuffer(), params.clinician.toBuffer(), nonceBuffer],
      this.programId
    );

    const data = Buffer.concat([
      anchorDiscriminator('emergency_grant'),
      encodeBytes48(params.reEncryptionKey),
      encodeString(params.reason),
    ]);

    return new TransactionInstruction({
      keys: [
        { pubkey: params.clinician, isSigner: true, isWritable: true },
        { pubkey: params.supervisor, isSigner: true, isWritable: false },
        { pubkey: params.patientPassport, isSigner: false, isWritable: false },
        { pubkey: grantPDA, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: this.programId,
      data,
    });
  }
}

// === Consent Registry Builders ===

export class ConsentBuilder {
  constructor(private programId: PublicKey) {}

  /** Record a new patient consent */
  recordConsent(params: {
    patient: PublicKey;
    witness?: PublicKey;
    consentType: ConsentType;
    scope: string;
    grantedTo?: PublicKey;
    durationSeconds?: number;
    method: ConsentMethod;
    nonce: bigint;
  }): TransactionInstruction {
    const nonceBuffer = Buffer.alloc(8);
    nonceBuffer.writeBigUInt64LE(params.nonce);

    const [consentPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('consent'), params.patient.toBuffer(), Buffer.from([params.consentType]), nonceBuffer],
      this.programId
    );

    const data = Buffer.concat([
      anchorDiscriminator('record_consent'),
      encodeU8(params.consentType),
      encodeString(params.scope),
      encodeOption(params.grantedTo ?? null, (k) => k.toBuffer()),
      encodeOption(params.durationSeconds ?? null, (v) => encodeI64(v)),
      encodeU8(params.method),
      encodeU64(params.nonce),
    ]);

    const keys = [
      { pubkey: params.patient, isSigner: true, isWritable: true },
    ];
    // Optional witness account
    if (params.witness) {
      keys.push({ pubkey: params.witness, isSigner: true, isWritable: false });
    }
    keys.push(
      { pubkey: consentPDA, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    );

    return new TransactionInstruction({ keys, programId: this.programId, data });
  }

  /** Revoke consent */
  revokeConsent(params: {
    patient: PublicKey;
    consent: PublicKey;
  }): TransactionInstruction {
    return new TransactionInstruction({
      keys: [
        { pubkey: params.patient, isSigner: true, isWritable: false },
        { pubkey: params.consent, isSigner: false, isWritable: true },
      ],
      programId: this.programId,
      data: anchorDiscriminator('revoke_consent'),
    });
  }
}

// === Audit Logger Builders ===

export class AuditBuilder {
  constructor(private programId: PublicKey) {}

  /** Log an audit event (append-only, immutable) */
  logEvent(params: {
    actor: PublicKey;
    action: AuditAction;
    targetPatient: PublicKey;
    targetRecord?: PublicKey;
    ipHash: Uint8Array;
    deviceHash: Uint8Array;
    metadata: string;
  }): TransactionInstruction {
    const now = BigInt(Math.floor(Date.now() / 1000));
    const [auditPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('audit'), params.actor.toBuffer(), Buffer.alloc(8, 0)], // simplified
      this.programId
    );

    const data = Buffer.concat([
      anchorDiscriminator('log_event'),
      encodeU8(params.action),
      params.targetPatient.toBuffer(),
      encodeOption(params.targetRecord ?? null, (k) => k.toBuffer()),
      encodeBytes32(params.ipHash),
      encodeBytes32(params.deviceHash),
      encodeString(params.metadata),
    ]);

    return new TransactionInstruction({
      keys: [
        { pubkey: params.actor, isSigner: true, isWritable: true },
        { pubkey: auditPDA, isSigner: false, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      programId: this.programId,
      data,
    });
  }
}
