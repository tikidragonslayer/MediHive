import { Connection, PublicKey, clusterApiUrl } from '@solana/web3.js';
import {
  PatientPassport,
  PassportStatus,
  MedicalRecord,
  RecordType,
  RecordStatus,
  AccessGrant,
  GrantStatus,
  AuditEntry,
  AuditAction,
  EncryptedRecord,
} from '../../../vault-sdk/src/types';

/**
 * Blockchain Sync Service — bridges Solana on-chain state with Firestore.
 *
 * Responsibilities:
 * - Read passport PDAs from Solana and mirror to Firestore
 * - Encrypt records, upload to IPFS, mint Record NFTs
 * - Create Access Grant NFTs for doctor-patient relationships
 * - Verify integrity between Firestore and on-chain data
 * - Fetch audit trail history from chain
 *
 * Uses Solana devnet for development. Switch to mainnet-beta for production.
 */

// ── PDA Seeds (must match the Anchor program) ──
const PROGRAM_ID = new PublicKey(
  process.env.MEDIHIVE_PROGRAM_ID ?? '11111111111111111111111111111111'
);
const PASSPORT_SEED = 'passport';
const RECORD_SEED = 'record';
const GRANT_SEED = 'grant';
const AUDIT_SEED = 'audit';

// ── Firestore types (lightweight stand-ins — replace with firebase-admin in prod) ──
interface FirestoreDoc {
  [key: string]: unknown;
}

interface FirestoreAdapter {
  getDoc(collection: string, docId: string): Promise<FirestoreDoc | null>;
  setDoc(collection: string, docId: string, data: FirestoreDoc): Promise<void>;
  updateDoc(collection: string, docId: string, data: Partial<FirestoreDoc>): Promise<void>;
  queryDocs(collection: string, field: string, value: unknown): Promise<FirestoreDoc[]>;
}

// ── IPFS adapter interface ──
interface IPFSAdapter {
  upload(encrypted: Uint8Array): Promise<string>; // returns CID
  fetch(cid: string): Promise<Uint8Array>;
}

// ── Encryption adapter interface ──
interface EncryptionAdapter {
  encrypt(data: Uint8Array, publicKey: Uint8Array): Promise<EncryptedRecord>;
}

// ── Sync queue types ──
export enum SyncOperation {
  SyncPassport = 'sync_passport',
  SyncRecord = 'sync_record',
  SyncGrant = 'sync_grant',
  VerifyIntegrity = 'verify_integrity',
}

interface SyncJob {
  id: string;
  operation: SyncOperation;
  payload: Record<string, unknown>;
  retries: number;
  maxRetries: number;
  createdAt: number;
  lastAttempt?: number;
  error?: string;
}

interface SyncResult {
  success: boolean;
  txSignature?: string;
  firestoreDocId?: string;
  error?: string;
}

interface IntegrityReport {
  patientId: string;
  checkedAt: string;
  onChainRecordCount: number;
  firestoreRecordCount: number;
  discrepancies: Array<{
    type: 'missing_onchain' | 'missing_firestore' | 'hash_mismatch';
    recordId: string;
    details: string;
  }>;
  isConsistent: boolean;
}

interface AuditHistoryEntry {
  actor: string;
  action: string;
  targetRecord: string | null;
  timestamp: string;
  metadata: string;
}

// ── SyncQueue — batches and retries failed operations ──

export class SyncQueue {
  private queue: SyncJob[] = [];
  private processing = false;
  private readonly batchSize: number;
  private readonly processInterval: ReturnType<typeof setInterval>;

  constructor(
    private readonly processor: (job: SyncJob) => Promise<SyncResult>,
    options?: { batchSize?: number; intervalMs?: number }
  ) {
    this.batchSize = options?.batchSize ?? 10;
    // Process queue every 5 seconds by default
    this.processInterval = setInterval(() => this.processBatch(), options?.intervalMs ?? 5_000);
  }

  enqueue(operation: SyncOperation, payload: Record<string, unknown>, maxRetries = 3): string {
    const id = `${operation}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    this.queue.push({
      id,
      operation,
      payload,
      retries: 0,
      maxRetries,
      createdAt: Date.now(),
    });
    return id;
  }

  async processBatch(): Promise<SyncResult[]> {
    if (this.processing || this.queue.length === 0) return [];
    this.processing = true;

    const batch = this.queue.splice(0, this.batchSize);
    const results: SyncResult[] = [];

    for (const job of batch) {
      job.lastAttempt = Date.now();
      try {
        const result = await this.processor(job);
        results.push(result);
      } catch (err) {
        job.retries++;
        job.error = err instanceof Error ? err.message : String(err);

        if (job.retries < job.maxRetries) {
          // Re-enqueue for retry
          this.queue.push(job);
        }

        results.push({ success: false, error: job.error });
      }
    }

    this.processing = false;
    return results;
  }

  pending(): number {
    return this.queue.length;
  }

  destroy(): void {
    clearInterval(this.processInterval);
  }
}

// ── Main BlockchainSync Service ──

export class BlockchainSyncService {
  private connection: Connection;
  private firestore: FirestoreAdapter;
  private ipfs: IPFSAdapter;
  private encryption: EncryptionAdapter;
  private syncQueue: SyncQueue;

  constructor(config: {
    firestore: FirestoreAdapter;
    ipfs: IPFSAdapter;
    encryption: EncryptionAdapter;
    solanaEndpoint?: string;
  }) {
    this.connection = new Connection(
      config.solanaEndpoint ?? clusterApiUrl('devnet'),
      'confirmed'
    );
    this.firestore = config.firestore;
    this.ipfs = config.ipfs;
    this.encryption = config.encryption;

    this.syncQueue = new SyncQueue((job) => this.processJob(job), {
      batchSize: 10,
      intervalMs: 5_000,
    });
  }

  /**
   * Read passport PDA from Solana, update Firestore users collection.
   */
  async syncPassport(walletPubkey: string): Promise<SyncResult> {
    try {
      const wallet = new PublicKey(walletPubkey);
      const [passportPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from(PASSPORT_SEED), wallet.toBuffer()],
        PROGRAM_ID
      );

      const accountInfo = await this.connection.getAccountInfo(passportPDA);
      if (!accountInfo) {
        return { success: false, error: 'Passport PDA not found on chain' };
      }

      // Deserialize passport account data
      // In production, use Anchor's BorshAccountsCoder for proper deserialization
      const passport = this.deserializePassport(accountInfo.data);

      // Update Firestore users collection
      await this.firestore.setDoc('users', walletPubkey, {
        walletPubkey,
        passportPDA: passportPDA.toBase58(),
        status: PassportStatus[passport.status],
        publicEncryptionKey: Buffer.from(passport.publicEncryptionKey).toString('base64'),
        guardianCount: passport.guardians.length,
        emergencyHospitalShard: passport.emergencyHospitalShard,
        createdAt: new Date(passport.createdAt * 1000).toISOString(),
        lastSyncedAt: new Date().toISOString(),
      });

      return {
        success: true,
        firestoreDocId: walletPubkey,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      // Queue for retry on transient failures
      this.syncQueue.enqueue(SyncOperation.SyncPassport, { walletPubkey });
      return { success: false, error };
    }
  }

  /**
   * Encrypt record, upload to IPFS, mint Record NFT on Solana, update Firestore.
   */
  async syncRecordToChain(
    patientId: string,
    recordData: {
      type: RecordType;
      content: Uint8Array;
      authorPubkey: string;
      icdCodes?: string[];
    }
  ): Promise<SyncResult> {
    try {
      const patient = new PublicKey(patientId);
      const author = new PublicKey(recordData.authorPubkey);

      // 1. Get patient's public encryption key from Firestore
      const userDoc = await this.firestore.getDoc('users', patientId);
      if (!userDoc?.publicEncryptionKey) {
        return { success: false, error: 'Patient encryption key not found' };
      }
      const encKey = Uint8Array.from(
        Buffer.from(userDoc.publicEncryptionKey as string, 'base64')
      );

      // 2. Encrypt the record
      const encrypted = await this.encryption.encrypt(recordData.content, encKey);

      // 3. Upload encrypted data to IPFS
      const ipfsCid = await this.ipfs.upload(encrypted.ciphertext);

      // 4. Derive the record PDA
      const recordCount = await this.getRecordCount(patientId);
      const [recordPDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from(RECORD_SEED),
          patient.toBuffer(),
          Buffer.from(new Uint32Array([recordCount]).buffer),
        ],
        PROGRAM_ID
      );

      // 5. Build and send the mint transaction
      // In production, this would build an Anchor instruction and sign with the server keypair.
      // For now, we record the intent and let the client-side wallet sign.
      const txIntent = {
        programId: PROGRAM_ID.toBase58(),
        instruction: 'mint_record',
        accounts: {
          patientPassport: patientId,
          record: recordPDA.toBase58(),
          author: recordData.authorPubkey,
        },
        args: {
          recordType: recordData.type,
          contentHash: Buffer.from(encrypted.contentHash).toString('hex'),
          ipfsCid,
          icdCodesHash: recordData.icdCodes
            ? this.hashCodes(recordData.icdCodes)
            : '0'.repeat(64),
        },
      };

      // 6. Update Firestore with the sync record
      const syncDocId = `${patientId}_${recordCount}`;
      await this.firestore.setDoc('blockchain_sync', syncDocId, {
        patientId,
        recordPDA: recordPDA.toBase58(),
        ipfsCid,
        recordType: RecordType[recordData.type],
        contentHash: Buffer.from(encrypted.contentHash).toString('hex'),
        authorPubkey: recordData.authorPubkey,
        status: 'pending_signature',
        txIntent,
        createdAt: new Date().toISOString(),
      });

      return {
        success: true,
        firestoreDocId: syncDocId,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.syncQueue.enqueue(SyncOperation.SyncRecord, {
        patientId,
        recordType: recordData.type,
        authorPubkey: recordData.authorPubkey,
      });
      return { success: false, error };
    }
  }

  /**
   * Create Access Grant NFT for a doctor-patient relationship.
   */
  async syncGrantToChain(grant: {
    patientPubkey: string;
    granteePubkey: string;
    scope: {
      recordTypes: number[];
      departments: string[];
      read: boolean;
      write: boolean;
      emergency: boolean;
    };
    validFrom: number;
    validUntil: number;
    reason: string;
  }): Promise<SyncResult> {
    try {
      const patient = new PublicKey(grant.patientPubkey);
      const grantee = new PublicKey(grant.granteePubkey);

      // Derive grant PDA
      const [grantPDA] = PublicKey.findProgramAddressSync(
        [
          Buffer.from(GRANT_SEED),
          patient.toBuffer(),
          grantee.toBuffer(),
        ],
        PROGRAM_ID
      );

      // Build grant transaction intent
      const txIntent = {
        programId: PROGRAM_ID.toBase58(),
        instruction: 'create_grant',
        accounts: {
          patient: grant.patientPubkey,
          grantee: grant.granteePubkey,
          grant: grantPDA.toBase58(),
        },
        args: {
          scope: grant.scope,
          validFrom: grant.validFrom,
          validUntil: grant.validUntil,
          reason: grant.reason,
        },
      };

      // Store in Firestore
      const grantDocId = `${grant.patientPubkey}_${grant.granteePubkey}`;
      await this.firestore.setDoc('access_grants', grantDocId, {
        patientPubkey: grant.patientPubkey,
        granteePubkey: grant.granteePubkey,
        grantPDA: grantPDA.toBase58(),
        scope: grant.scope,
        validFrom: new Date(grant.validFrom * 1000).toISOString(),
        validUntil: new Date(grant.validUntil * 1000).toISOString(),
        reason: grant.reason,
        status: 'pending_signature',
        txIntent,
        createdAt: new Date().toISOString(),
      });

      return {
        success: true,
        firestoreDocId: grantDocId,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      this.syncQueue.enqueue(SyncOperation.SyncGrant, {
        patientPubkey: grant.patientPubkey,
        granteePubkey: grant.granteePubkey,
      });
      return { success: false, error };
    }
  }

  /**
   * Compare Firestore records against on-chain state, flag discrepancies.
   */
  async verifyChainIntegrity(patientId: string): Promise<IntegrityReport> {
    const report: IntegrityReport = {
      patientId,
      checkedAt: new Date().toISOString(),
      onChainRecordCount: 0,
      firestoreRecordCount: 0,
      discrepancies: [],
      isConsistent: true,
    };

    try {
      // Get all Firestore sync records for this patient
      const firestoreDocs = await this.firestore.queryDocs(
        'blockchain_sync',
        'patientId',
        patientId
      );
      report.firestoreRecordCount = firestoreDocs.length;

      // Check each Firestore record against on-chain state
      for (const doc of firestoreDocs) {
        const recordPDA = doc.recordPDA as string | undefined;
        if (!recordPDA) continue;

        try {
          const accountInfo = await this.connection.getAccountInfo(
            new PublicKey(recordPDA)
          );

          if (!accountInfo) {
            report.discrepancies.push({
              type: 'missing_onchain',
              recordId: recordPDA,
              details: `Record PDA ${recordPDA} exists in Firestore but not on chain`,
            });
            continue;
          }

          report.onChainRecordCount++;

          // Verify content hash matches
          const onChainHash = this.extractContentHash(accountInfo.data);
          const firestoreHash = doc.contentHash as string | undefined;
          if (onChainHash && firestoreHash && onChainHash !== firestoreHash) {
            report.discrepancies.push({
              type: 'hash_mismatch',
              recordId: recordPDA,
              details: `Content hash mismatch: chain=${onChainHash} firestore=${firestoreHash}`,
            });
          }
        } catch {
          // Non-fatal: individual record check failure
          report.discrepancies.push({
            type: 'missing_onchain',
            recordId: recordPDA,
            details: `Failed to fetch on-chain account for ${recordPDA}`,
          });
        }
      }

      report.isConsistent = report.discrepancies.length === 0;
    } catch (err) {
      report.isConsistent = false;
      report.discrepancies.push({
        type: 'missing_firestore',
        recordId: 'N/A',
        details: `Integrity check failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }

    return report;
  }

  /**
   * Fetch all on-chain audit entries for a patient.
   */
  async getRecordHistory(patientId: string): Promise<AuditHistoryEntry[]> {
    try {
      const patient = new PublicKey(patientId);
      const entries: AuditHistoryEntry[] = [];

      // Fetch audit entries using getProgramAccounts with memcmp filter
      // Filter by targetPatient field in the audit account data
      const accounts = await this.connection.getProgramAccounts(PROGRAM_ID, {
        filters: [
          {
            memcmp: {
              offset: 8 + 32, // discriminator (8) + actor pubkey (32) + action (1) => target patient starts at offset 41
              // Simplified: offset depends on exact Anchor layout. Adjust in production.
              bytes: patient.toBase58(),
            },
          },
        ],
      });

      for (const { account } of accounts) {
        try {
          const audit = this.deserializeAuditEntry(account.data);
          entries.push({
            actor: audit.actor.toBase58(),
            action: AuditAction[audit.action],
            targetRecord: audit.targetRecord?.toBase58() ?? null,
            timestamp: new Date(audit.timestamp * 1000).toISOString(),
            metadata: audit.metadata,
          });
        } catch {
          // Skip malformed entries
        }
      }

      // Sort by timestamp descending (newest first)
      entries.sort((a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );

      return entries;
    } catch (err) {
      throw new Error(
        `Failed to fetch record history: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  /** Get the number of pending sync jobs */
  pendingSyncs(): number {
    return this.syncQueue.pending();
  }

  /** Clean up resources */
  destroy(): void {
    this.syncQueue.destroy();
  }

  // ── Private helpers ──

  private async processJob(job: SyncJob): Promise<SyncResult> {
    switch (job.operation) {
      case SyncOperation.SyncPassport:
        return this.syncPassport(job.payload.walletPubkey as string);
      case SyncOperation.SyncRecord:
        return this.syncRecordToChain(job.payload.patientId as string, {
          type: job.payload.recordType as RecordType,
          content: new Uint8Array(),
          authorPubkey: job.payload.authorPubkey as string,
        });
      case SyncOperation.SyncGrant:
        return this.syncGrantToChain(job.payload as any);
      case SyncOperation.VerifyIntegrity:
        await this.verifyChainIntegrity(job.payload.patientId as string);
        return { success: true };
      default:
        return { success: false, error: `Unknown operation: ${job.operation}` };
    }
  }

  private async getRecordCount(patientId: string): Promise<number> {
    const docs = await this.firestore.queryDocs('blockchain_sync', 'patientId', patientId);
    return docs.length;
  }

  /**
   * Deserialize a Passport account from raw bytes.
   * In production, use Anchor's BorshAccountsCoder.
   * This is a placeholder that handles the expected layout.
   */
  private deserializePassport(data: Buffer): PatientPassport {
    // Skip 8-byte Anchor discriminator
    const offset = 8;
    const authority = new PublicKey(data.subarray(offset, offset + 32));

    // Simplified deserialization — in production use Anchor IDL + BorshCoder
    return {
      authority,
      mrnHash: new Uint8Array(data.subarray(offset + 32, offset + 64)),
      identityHash: new Uint8Array(data.subarray(offset + 64, offset + 96)),
      publicEncryptionKey: new Uint8Array(data.subarray(offset + 96, offset + 128)),
      recoveryThreshold: data.readUInt8(offset + 128),
      guardians: [],
      emergencyHospitalShard: data.readUInt8(offset + 129) === 1,
      createdAt: Number(data.readBigInt64LE(offset + 130)),
      status: data.readUInt8(offset + 138) as PassportStatus,
      bump: data.readUInt8(offset + 139),
    };
  }

  /**
   * Deserialize an AuditEntry from raw account data.
   * Simplified — use Anchor coder in production.
   */
  private deserializeAuditEntry(data: Buffer): AuditEntry {
    const offset = 8; // skip discriminator
    return {
      actor: new PublicKey(data.subarray(offset, offset + 32)),
      action: data.readUInt8(offset + 32) as AuditAction,
      targetPatient: new PublicKey(data.subarray(offset + 33, offset + 65)),
      targetRecord: data.readUInt8(offset + 65)
        ? new PublicKey(data.subarray(offset + 66, offset + 98))
        : null,
      timestamp: Number(data.readBigInt64LE(offset + 98)),
      ipHash: new Uint8Array(data.subarray(offset + 106, offset + 138)),
      deviceHash: new Uint8Array(data.subarray(offset + 138, offset + 170)),
      metadata: '',
      bump: data.readUInt8(offset + 170),
    };
  }

  /**
   * Extract the content hash from a record account's raw data.
   */
  private extractContentHash(data: Buffer): string | null {
    try {
      // Skip discriminator (8) + patientPassport (32) + recordType (1) = 41
      const hash = data.subarray(41, 73);
      return Buffer.from(hash).toString('hex');
    } catch {
      return null;
    }
  }

  /**
   * Hash an array of ICD/CPT codes into a single 32-byte hex string.
   */
  private hashCodes(codes: string[]): string {
    // Simple deterministic hash — in production use SHA-256
    const joined = codes.sort().join('|');
    const encoder = new TextEncoder();
    const bytes = encoder.encode(joined);
    // Pad/truncate to 32 bytes for on-chain storage
    const hash = new Uint8Array(32);
    for (let i = 0; i < bytes.length; i++) {
      hash[i % 32] ^= bytes[i];
    }
    return Buffer.from(hash).toString('hex');
  }
}
