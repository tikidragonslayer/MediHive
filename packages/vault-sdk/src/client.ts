import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { PatientPassportSDK } from './passport';
import { RecordManagerSDK } from './records';
import { AccessGrantsSDK } from './grants';
import { ConsentRegistrySDK } from './consent';
import { AuditLoggerSDK } from './audit';

export interface MediHiveConfig {
  rpcUrl: string;
  patientPassportProgramId: string;
  recordManagerProgramId: string;
  accessGrantsProgramId: string;
  consentRegistryProgramId: string;
  auditLoggerProgramId: string;
}

const DEVNET_CONFIG: MediHiveConfig = {
  rpcUrl: 'https://api.devnet.solana.com',
  patientPassportProgramId: '4qcKgX68Yss43mR9XbuM2Ea9KhC3jvVRy3MJJKKm8jKn',
  recordManagerProgramId: '21s29kpMXWYMbsZbJcfFHsyfnFjmu5dwybKpGaADUk4i',
  accessGrantsProgramId: 'CBsD1f6ex2us5X2Tm4DULEa8gLr4n6yw5hsSUmyyHHW2',
  consentRegistryProgramId: 'FJTDfUACnh1GPVcp8KpSR6uEDzcW8AyL7KU7zrAJ3rcx',
  auditLoggerProgramId: 'FQMNRzPZj8QFDy6akX6EX79mrgUHKaCzSgrNuAJTk8is',
};

export class MediHiveClient {
  public connection: Connection;
  public config: MediHiveConfig;

  public passport: PatientPassportSDK;
  public records: RecordManagerSDK;
  public grants: AccessGrantsSDK;
  public consent: ConsentRegistrySDK;
  public audit: AuditLoggerSDK;

  constructor(config?: Partial<MediHiveConfig>) {
    this.config = { ...DEVNET_CONFIG, ...config };
    this.connection = new Connection(this.config.rpcUrl, 'confirmed');

    this.passport = new PatientPassportSDK(
      this.connection,
      new PublicKey(this.config.patientPassportProgramId)
    );
    this.records = new RecordManagerSDK(
      this.connection,
      new PublicKey(this.config.recordManagerProgramId)
    );
    this.grants = new AccessGrantsSDK(
      this.connection,
      new PublicKey(this.config.accessGrantsProgramId)
    );
    this.consent = new ConsentRegistrySDK(
      this.connection,
      new PublicKey(this.config.consentRegistryProgramId)
    );
    this.audit = new AuditLoggerSDK(
      this.connection,
      new PublicKey(this.config.auditLoggerProgramId)
    );
  }

  /** Derive the PDA for a patient passport */
  getPassportPDA(patientWallet: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('passport'), patientWallet.toBuffer()],
      new PublicKey(this.config.patientPassportProgramId)
    );
  }

  /** Derive the PDA for a medical record */
  getRecordPDA(
    patientPassport: PublicKey,
    contentHash: Uint8Array
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('record'), patientPassport.toBuffer(), Buffer.from(contentHash)],
      new PublicKey(this.config.recordManagerProgramId)
    );
  }

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
      new PublicKey(this.config.accessGrantsProgramId)
    );
  }

  /** Derive the PDA for a consent record */
  getConsentPDA(
    patient: PublicKey,
    consentType: number,
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
      new PublicKey(this.config.consentRegistryProgramId)
    );
  }
}
