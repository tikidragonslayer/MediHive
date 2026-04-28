import { randomUUID, createHash } from 'crypto';
import { EventEmitter } from 'events';
import { MediScribe } from './scribe';
import { SOAPGenerator } from './soap-generator';
import {
  TranscriptSegment,
  ClinicalEntity,
  SOAPNote,
  ScribeSession,
} from './types';

// ── External package types (re-declared to avoid hard import coupling) ──

/** Patient context summary from FHIR records */
export interface PatientSummary {
  demographics?: { name: string; gender: string; birthDate: string; mrn: string };
  activeConditions: Array<{ code: string; display: string; onset: string }>;
  currentMedications: Array<{ name: string; dosage: string }>;
  allergies: Array<{ substance: string; severity: string }>;
  latestVitals: Record<string, { value: string; date: string }>;
  recentLabs: Array<{ name: string; value: string; date: string }>;
}

/** Mirrors scribe-asr TranscriptionResult */
export interface TranscriptionResult {
  text: string;
  segments: Array<{
    id: number;
    start: number;
    end: number;
    text: string;
    confidence: number;
  }>;
  language: string;
  duration: number;
  processingTime: number;
}

/** Result of the full voice-to-NFT pipeline */
export interface PipelineResult {
  sessionId: string;
  patientId: string;
  clinicianId: string;
  transcript: TranscriptSegment[];
  entities: ClinicalEntity[];
  soapNote: SOAPNote;
  nftAddress: string;
  ipfsCid: string;
  txSignature: string;
  contentHash: string;
  totalDurationMs: number;
}

/** Session states tracked through the pipeline */
export type SessionState =
  | 'created'
  | 'recording'
  | 'transcribing'
  | 'extracting'
  | 'generating_soap'
  | 'reviewing'
  | 'signed'
  | 'encrypting'
  | 'uploading_ipfs'
  | 'minting_nft'
  | 'complete'
  | 'error';

/** Internal pipeline session extending the NLP ScribeSession */
interface PipelineSession {
  sessionId: string;
  patientId: string;
  clinicianId: string;
  consentVerified: boolean;
  state: SessionState;
  createdAt: string;
  updatedAt: string;
  audioChunks: Buffer[];
  transcript: TranscriptSegment[];
  entities: ClinicalEntity[];
  soapNote?: SOAPNote;
  clinicianSignature?: { pubkey: string; signature: Uint8Array; signedAt: string };
  ipfsCid?: string;
  nftAddress?: string;
  txSignature?: string;
  contentHash?: string;
  error?: string;
  auditLog: AuditEntry[];
}

interface AuditEntry {
  timestamp: string;
  action: string;
  actor: string;
  details: string;
}

// ── Adapter interfaces for external dependencies ──

/** Adapter for the scribe-asr AudioPipeline */
export interface ASRAdapter {
  transcribe(audioBuffer: Buffer): Promise<TranscriptionResult>;
}

/** Adapter for bridge-core IPFSStorage */
export interface IPFSAdapter {
  uploadEncryptedRecord(
    fhirBundleJson: string,
    encryptionKey: Uint8Array,
    metadata?: { patientId?: string; recordType?: string }
  ): Promise<{ cid: string; size: number; contentHash: string; gatewayUrl: string }>;
}

/** Adapter for vault-sdk record minting on Solana */
export interface BlockchainAdapter {
  mintRecord(params: {
    patientId: string;
    authorPubkey: string;
    contentHash: Uint8Array;
    ipfsCid: string;
    recordType: number; // RecordType.Note = 0
    icdCodesHash?: Uint8Array;
  }): Promise<{ nftAddress: string; txSignature: string }>;
}

/** Adapter for Firestore session persistence */
export interface FirestoreAdapter {
  setDoc(collection: string, docId: string, data: Record<string, unknown>): Promise<void>;
  updateDoc(collection: string, docId: string, data: Record<string, unknown>): Promise<void>;
  getDoc(collection: string, docId: string): Promise<Record<string, unknown> | null>;
}

/** Adapter for shield-encryption */
export interface EncryptionAdapter {
  /** Encrypt plaintext with the patient's key, returning ciphertext + content hash */
  packageForIPFS(plaintext: string, encryptionKey: Uint8Array): {
    encryptedPayload: string;
    contentHash: string;
  };
}

// ── Pipeline configuration ──

export interface VoiceToNFTConfig {
  asr: ASRAdapter;
  ipfs: IPFSAdapter;
  blockchain: BlockchainAdapter;
  firestore: FirestoreAdapter;
  encryption: EncryptionAdapter;
  anthropicApiKey?: string;
  /** Firestore collection for scribe sessions (default: 'scribe_sessions') */
  sessionCollection?: string;
}

// ── Event types emitted by the pipeline ──

export interface PipelineEvents {
  'session:created': { sessionId: string; patientId: string; clinicianId: string };
  'session:stateChange': { sessionId: string; from: SessionState; to: SessionState };
  'transcript:chunk': { sessionId: string; text: string; segmentCount: number };
  'transcript:finalized': { sessionId: string; segmentCount: number; entityCount: number };
  'soap:generated': { sessionId: string; reviewStatus: string };
  'note:signed': { sessionId: string; clinicianPubkey: string };
  'record:encrypted': { sessionId: string; contentHash: string };
  'ipfs:uploaded': { sessionId: string; cid: string };
  'nft:minted': { sessionId: string; nftAddress: string; txSignature: string };
  'pipeline:complete': { sessionId: string; result: PipelineResult };
  'pipeline:error': { sessionId: string; step: string; error: string };
}

// ── Main orchestrator ──

/**
 * VoiceToNFTPipeline -- End-to-end orchestrator connecting:
 *
 *   Audio -> ASR (Whisper + diarization)
 *       -> NLP (entity extraction + SOAP generation via Claude)
 *           -> Encryption (AES-256-GCM with patient X25519 key)
 *               -> IPFS (encrypted FHIR DocumentReference)
 *                   -> Solana (mint Record NFT with content hash)
 *                       -> Firestore (session metadata)
 *
 * Each step updates Firestore and emits events for real-time UI.
 */
export class VoiceToNFTPipeline extends EventEmitter {
  private sessions: Map<string, PipelineSession> = new Map();
  private mediScribe: MediScribe;
  private soapGenerator: SOAPGenerator;
  private asr: ASRAdapter;
  private ipfs: IPFSAdapter;
  private blockchain: BlockchainAdapter;
  private firestore: FirestoreAdapter;
  private encryption: EncryptionAdapter;
  private sessionCollection: string;

  constructor(config: VoiceToNFTConfig) {
    super();
    this.asr = config.asr;
    this.ipfs = config.ipfs;
    this.blockchain = config.blockchain;
    this.firestore = config.firestore;
    this.encryption = config.encryption;
    this.sessionCollection = config.sessionCollection ?? 'scribe_sessions';
    this.mediScribe = new MediScribe(config.anthropicApiKey);
    this.soapGenerator = new SOAPGenerator(config.anthropicApiKey);
  }

  // ──────────────────────────────────────────────────────────
  // Step 1: Start a recording session (verify consent first)
  // ──────────────────────────────────────────────────────────

  async startSession(
    patientId: string,
    clinicianId: string,
    consentVerified: boolean
  ): Promise<string> {
    if (!consentVerified) {
      throw new Error(
        'Patient consent for ambient recording must be verified before starting a session. ' +
        'This is a HIPAA requirement.'
      );
    }

    const sessionId = randomUUID();
    const now = new Date().toISOString();

    const session: PipelineSession = {
      sessionId,
      patientId,
      clinicianId,
      consentVerified: true,
      state: 'created',
      createdAt: now,
      updatedAt: now,
      audioChunks: [],
      transcript: [],
      entities: [],
      auditLog: [],
    };

    this.sessions.set(sessionId, session);

    // Start a parallel MediScribe session for NLP processing
    const nlpSessionId = this.mediScribe.startSession(patientId, clinicianId);
    this.mediScribe.verifyConsent(nlpSessionId);
    // Store the NLP session ID mapping
    (session as any)._nlpSessionId = nlpSessionId;

    this.addAuditEntry(session, 'session_started', clinicianId, `Patient ${patientId}, consent verified`);

    // Persist to Firestore
    await this.persistSession(session);

    this.emit('session:created', { sessionId, patientId, clinicianId });
    await this.transitionState(session, 'recording');

    return sessionId;
  }

  // ──────────────────────────────────────────────────────────
  // Step 2: Process audio chunk (streaming from edge GPU)
  // ──────────────────────────────────────────────────────────

  async processAudioChunk(
    sessionId: string,
    audioBuffer: Buffer
  ): Promise<TranscriptionResult> {
    const session = this.getSession(sessionId);
    this.assertState(session, ['recording', 'transcribing']);

    if (session.state === 'recording') {
      await this.transitionState(session, 'transcribing');
    }

    // Accumulate the raw audio
    session.audioChunks.push(audioBuffer);

    // Send to ASR for transcription
    let result: TranscriptionResult;
    try {
      result = await this.asr.transcribe(audioBuffer);
    } catch (err) {
      this.addAuditEntry(session, 'asr_error', session.clinicianId, String(err));
      await this.handleError(session, 'processAudioChunk', err);
      throw err;
    }

    // Convert ASR segments to TranscriptSegments
    const newSegments: TranscriptSegment[] = result.segments.map((s) => ({
      speaker: 'unknown' as const,
      text: s.text,
      startTime: s.start,
      endTime: s.end,
      confidence: s.confidence,
    }));

    session.transcript.push(...newSegments);
    session.updatedAt = new Date().toISOString();

    this.addAuditEntry(
      session,
      'audio_chunk_processed',
      'system',
      `${result.segments.length} segments, ${result.duration}s audio`
    );

    // Partial persist (don't await to keep streaming fast)
    this.persistSession(session).catch(() => {
      /* non-fatal: Firestore update for partial transcript */
    });

    this.emit('transcript:chunk', {
      sessionId,
      text: result.text,
      segmentCount: session.transcript.length,
    });

    return result;
  }

  // ──────────────────────────────────────────────────────────
  // Step 3: Finalize transcript and extract entities
  // ──────────────────────────────────────────────────────────

  async finalizeTranscript(
    sessionId: string
  ): Promise<{ entities: ClinicalEntity[]; transcript: TranscriptSegment[] }> {
    const session = this.getSession(sessionId);
    this.assertState(session, ['recording', 'transcribing']);
    await this.transitionState(session, 'extracting');

    if (session.transcript.length === 0) {
      throw new Error('No transcript data to finalize. Process audio chunks first.');
    }

    // Feed the full transcript into MediScribe for entity extraction
    const nlpSessionId = (session as any)._nlpSessionId as string;
    try {
      await this.mediScribe.addFullTranscript(nlpSessionId, session.transcript);
      const nlpData = this.mediScribe.getSessionData(nlpSessionId);
      session.entities = nlpData.entities;
    } catch (err) {
      this.addAuditEntry(session, 'entity_extraction_error', 'system', String(err));
      await this.handleError(session, 'finalizeTranscript', err);
      throw err;
    }

    session.updatedAt = new Date().toISOString();
    this.addAuditEntry(
      session,
      'transcript_finalized',
      'system',
      `${session.transcript.length} segments, ${session.entities.length} entities extracted`
    );

    await this.persistSession(session);

    this.emit('transcript:finalized', {
      sessionId,
      segmentCount: session.transcript.length,
      entityCount: session.entities.length,
    });

    return { entities: session.entities, transcript: session.transcript };
  }

  // ──────────────────────────────────────────────────────────
  // Step 4: Generate SOAP note from transcript + entities
  // ──────────────────────────────────────────────────────────

  async generateSOAPNote(
    sessionId: string,
    patientContext: PatientSummary
  ): Promise<SOAPNote> {
    const session = this.getSession(sessionId);
    this.assertState(session, ['extracting']);
    await this.transitionState(session, 'generating_soap');

    try {
      const soapNote = await this.soapGenerator.generateSOAPNote(
        session.transcript,
        session.entities,
        patientContext
      );

      session.soapNote = soapNote;
      session.updatedAt = new Date().toISOString();

      this.addAuditEntry(
        session,
        'soap_generated',
        'system',
        `ICD codes: ${soapNote.icdCodes.length}, CPT codes: ${soapNote.cptCodes.length}`
      );

      await this.persistSession(session);
      await this.transitionState(session, 'reviewing');

      this.emit('soap:generated', {
        sessionId,
        reviewStatus: soapNote.reviewStatus,
      });

      return soapNote;
    } catch (err) {
      this.addAuditEntry(session, 'soap_generation_error', 'system', String(err));
      await this.handleError(session, 'generateSOAPNote', err);
      throw err;
    }
  }

  // ──────────────────────────────────────────────────────────
  // Step 5: Clinician reviews and signs the note
  // ──────────────────────────────────────────────────────────

  async signNote(
    sessionId: string,
    clinicianPubkey: string,
    signature: Uint8Array
  ): Promise<void> {
    const session = this.getSession(sessionId);
    this.assertState(session, ['reviewing']);

    if (!session.soapNote) {
      throw new Error('No SOAP note to sign. Generate a SOAP note first.');
    }

    if (signature.length === 0) {
      throw new Error('Signature cannot be empty.');
    }

    // Mark the SOAP note as signed
    session.soapNote.reviewStatus = 'signed';
    session.clinicianSignature = {
      pubkey: clinicianPubkey,
      signature,
      signedAt: new Date().toISOString(),
    };
    session.updatedAt = new Date().toISOString();

    this.addAuditEntry(
      session,
      'note_signed',
      clinicianPubkey,
      'Clinician attestation complete'
    );

    await this.persistSession(session);
    await this.transitionState(session, 'signed');

    this.emit('note:signed', { sessionId, clinicianPubkey });
  }

  // ──────────────────────────────────────────────────────────
  // Step 6: Encrypt, upload to IPFS, mint NFT (all in one)
  // ──────────────────────────────────────────────────────────

  async mintRecord(
    sessionId: string,
    patientEncryptionKey: Uint8Array
  ): Promise<{ nftAddress: string; ipfsCid: string; txSignature: string }> {
    const session = this.getSession(sessionId);
    this.assertState(session, ['signed']);

    if (!session.soapNote || session.soapNote.reviewStatus !== 'signed') {
      throw new Error('Note must be signed before minting. Call signNote() first.');
    }

    // ── 6a. Build FHIR DocumentReference ──
    await this.transitionState(session, 'encrypting');

    const fhirDocument = this.buildFHIRDocumentReference(session);
    const fhirJson = JSON.stringify(fhirDocument);

    // ── 6b. Encrypt with patient's key ──
    let encryptedPayload: string;
    let contentHash: string;
    try {
      const encrypted = this.encryption.packageForIPFS(fhirJson, patientEncryptionKey);
      encryptedPayload = encrypted.encryptedPayload;
      contentHash = encrypted.contentHash;
      session.contentHash = contentHash;

      this.addAuditEntry(session, 'record_encrypted', 'system', `Content hash: ${contentHash.slice(0, 16)}...`);
      this.emit('record:encrypted', { sessionId, contentHash });
    } catch (err) {
      this.addAuditEntry(session, 'encryption_error', 'system', String(err));
      await this.handleError(session, 'mintRecord:encrypt', err);
      throw err;
    }

    // ── 6c. Upload to IPFS ──
    await this.transitionState(session, 'uploading_ipfs');

    let ipfsCid: string;
    try {
      const ipfsResult = await this.ipfs.uploadEncryptedRecord(
        encryptedPayload,
        patientEncryptionKey,
        { patientId: session.patientId, recordType: 'clinical_note' }
      );
      ipfsCid = ipfsResult.cid;
      session.ipfsCid = ipfsCid;

      this.addAuditEntry(session, 'ipfs_uploaded', 'system', `CID: ${ipfsCid}`);
      this.emit('ipfs:uploaded', { sessionId, cid: ipfsCid });
    } catch (err) {
      this.addAuditEntry(session, 'ipfs_upload_error', 'system', String(err));
      await this.handleError(session, 'mintRecord:ipfs', err);
      throw err;
    }

    // ── 6d. Mint Record NFT on Solana ──
    await this.transitionState(session, 'minting_nft');

    const contentHashBytes = Uint8Array.from(Buffer.from(contentHash, 'hex'));
    const icdCodesHash = this.hashIcdCodes(session.soapNote.icdCodes);

    try {
      const mintResult = await this.blockchain.mintRecord({
        patientId: session.patientId,
        authorPubkey: session.clinicianSignature!.pubkey,
        contentHash: contentHashBytes,
        ipfsCid,
        recordType: 0, // RecordType.Note
        icdCodesHash,
      });

      session.nftAddress = mintResult.nftAddress;
      session.txSignature = mintResult.txSignature;

      this.addAuditEntry(
        session,
        'nft_minted',
        'system',
        `NFT: ${mintResult.nftAddress}, TX: ${mintResult.txSignature}`
      );

      await this.transitionState(session, 'complete');
      await this.persistSession(session);

      this.emit('nft:minted', {
        sessionId,
        nftAddress: mintResult.nftAddress,
        txSignature: mintResult.txSignature,
      });

      return {
        nftAddress: mintResult.nftAddress,
        ipfsCid,
        txSignature: mintResult.txSignature,
      };
    } catch (err) {
      this.addAuditEntry(session, 'nft_mint_error', 'system', String(err));
      // Rollback: the encrypted record is already on IPFS but the NFT failed.
      // The IPFS record is harmless (encrypted, no on-chain reference).
      // We log the orphaned CID so it can be cleaned up later.
      this.addAuditEntry(
        session,
        'rollback_note',
        'system',
        `Orphaned IPFS CID (no NFT): ${ipfsCid}. Manual cleanup may be needed.`
      );
      await this.handleError(session, 'mintRecord:blockchain', err);
      throw err;
    }
  }

  // ──────────────────────────────────────────────────────────
  // Full pipeline (for batch/testing)
  // ──────────────────────────────────────────────────────────

  async processFullRecording(
    audioBuffer: Buffer,
    patientId: string,
    clinicianId: string,
    patientContext: PatientSummary,
    patientEncryptionKey: Uint8Array
  ): Promise<PipelineResult> {
    const startTime = Date.now();

    // Step 1: Start session
    const sessionId = await this.startSession(patientId, clinicianId, true);

    // Step 2: Process audio as a single chunk
    await this.processAudioChunk(sessionId, audioBuffer);

    // Step 3: Finalize transcript
    const { entities, transcript } = await this.finalizeTranscript(sessionId);

    // Step 4: Generate SOAP note
    const soapNote = await this.generateSOAPNote(sessionId, patientContext);

    // Step 5: Auto-sign for batch mode (generate a deterministic signature)
    const batchSignature = new Uint8Array(
      createHash('sha256')
        .update(`batch-sign:${sessionId}:${clinicianId}`)
        .digest()
    );
    await this.signNote(sessionId, clinicianId, batchSignature);

    // Step 6: Encrypt, upload, mint
    const { nftAddress, ipfsCid, txSignature } = await this.mintRecord(
      sessionId,
      patientEncryptionKey
    );

    const session = this.getSession(sessionId);
    const totalDurationMs = Date.now() - startTime;

    const result: PipelineResult = {
      sessionId,
      patientId,
      clinicianId,
      transcript,
      entities,
      soapNote,
      nftAddress,
      ipfsCid,
      txSignature,
      contentHash: session.contentHash!,
      totalDurationMs,
    };

    this.emit('pipeline:complete', { sessionId, result });

    // Clean up in-memory session (Firestore has the persistent copy)
    this.sessions.delete(sessionId);

    return result;
  }

  // ──────────────────────────────────────────────────────────
  // Session management helpers
  // ──────────────────────────────────────────────────────────

  /** Get the current state of a session */
  getSessionState(sessionId: string): SessionState {
    return this.getSession(sessionId).state;
  }

  /** Get a read-only view of the session data */
  getSessionData(sessionId: string): Readonly<Omit<PipelineSession, 'audioChunks'>> {
    const session = this.getSession(sessionId);
    const { audioChunks, ...rest } = session;
    return rest;
  }

  /** Get the audit log for a session */
  getAuditLog(sessionId: string): readonly AuditEntry[] {
    return this.getSession(sessionId).auditLog;
  }

  /** Destroy a session (cleanup in-memory state) */
  destroySession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  // ──────────────────────────────────────────────────────────
  // Private helpers
  // ──────────────────────────────────────────────────────────

  private getSession(sessionId: string): PipelineSession {
    const session = this.sessions.get(sessionId);
    if (!session) {
      throw new Error(`Pipeline session not found: ${sessionId}`);
    }
    return session;
  }

  private assertState(session: PipelineSession, allowed: SessionState[]): void {
    if (!allowed.includes(session.state)) {
      throw new Error(
        `Invalid session state: '${session.state}'. Expected one of: ${allowed.join(', ')}. ` +
        `Session ${session.sessionId} cannot proceed.`
      );
    }
  }

  private async transitionState(session: PipelineSession, to: SessionState): Promise<void> {
    const from = session.state;
    session.state = to;
    session.updatedAt = new Date().toISOString();

    this.emit('session:stateChange', { sessionId: session.sessionId, from, to });

    // Persist state change to Firestore
    try {
      await this.firestore.updateDoc(this.sessionCollection, session.sessionId, {
        state: to,
        updatedAt: session.updatedAt,
      });
    } catch {
      // Non-fatal: state change persists in memory
    }
  }

  private async handleError(
    session: PipelineSession,
    step: string,
    err: unknown
  ): Promise<void> {
    const errorMessage = err instanceof Error ? err.message : String(err);
    session.state = 'error';
    session.error = `${step}: ${errorMessage}`;
    session.updatedAt = new Date().toISOString();

    this.emit('pipeline:error', {
      sessionId: session.sessionId,
      step,
      error: errorMessage,
    });

    try {
      await this.firestore.updateDoc(this.sessionCollection, session.sessionId, {
        state: 'error',
        error: session.error,
        updatedAt: session.updatedAt,
      });
    } catch {
      // Non-fatal
    }
  }

  private addAuditEntry(
    session: PipelineSession,
    action: string,
    actor: string,
    details: string
  ): void {
    session.auditLog.push({
      timestamp: new Date().toISOString(),
      action,
      actor,
      details,
    });
  }

  private async persistSession(session: PipelineSession): Promise<void> {
    const doc: Record<string, unknown> = {
      sessionId: session.sessionId,
      patientId: session.patientId,
      clinicianId: session.clinicianId,
      consentVerified: session.consentVerified,
      state: session.state,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      transcriptSegmentCount: session.transcript.length,
      entityCount: session.entities.length,
      hasSoapNote: !!session.soapNote,
      soapReviewStatus: session.soapNote?.reviewStatus ?? null,
      clinicianSignature: session.clinicianSignature
        ? {
            pubkey: session.clinicianSignature.pubkey,
            signedAt: session.clinicianSignature.signedAt,
            // Do not store raw signature bytes in Firestore
            signatureHash: createHash('sha256')
              .update(Buffer.from(session.clinicianSignature.signature))
              .digest('hex'),
          }
        : null,
      ipfsCid: session.ipfsCid ?? null,
      nftAddress: session.nftAddress ?? null,
      txSignature: session.txSignature ?? null,
      contentHash: session.contentHash ?? null,
      error: session.error ?? null,
      auditLog: session.auditLog,
      // Store SOAP note content for clinician review workflows
      soapNote: session.soapNote
        ? {
            subjective: session.soapNote.subjective,
            objective: session.soapNote.objective,
            assessment: session.soapNote.assessment,
            plan: session.soapNote.plan,
            icdCodes: session.soapNote.icdCodes,
            cptCodes: session.soapNote.cptCodes,
            medicationChanges: session.soapNote.medicationChanges,
            followUp: session.soapNote.followUp,
            generatedAt: session.soapNote.generatedAt,
            reviewStatus: session.soapNote.reviewStatus,
          }
        : null,
      // Store transcript for audit (without audio buffers)
      transcript: session.transcript.map((s) => ({
        speaker: s.speaker,
        text: s.text,
        startTime: s.startTime,
        endTime: s.endTime,
        confidence: s.confidence,
      })),
      entities: session.entities.map((e) => ({
        type: e.type,
        text: e.text,
        normalized: e.normalized ?? null,
        code: e.code ?? null,
        codeSystem: e.codeSystem ?? null,
        confidence: e.confidence,
      })),
    };

    await this.firestore.setDoc(this.sessionCollection, session.sessionId, doc);
  }

  /**
   * Build a FHIR R4 DocumentReference resource from the session data.
   * This is the document that gets encrypted and stored on IPFS.
   */
  private buildFHIRDocumentReference(session: PipelineSession): Record<string, unknown> {
    const soap = session.soapNote!;

    return {
      resourceType: 'DocumentReference',
      status: 'current',
      type: {
        coding: [
          {
            system: 'http://loinc.org',
            code: '11506-3',
            display: 'Progress note',
          },
        ],
      },
      subject: {
        reference: `Patient/${session.patientId}`,
      },
      author: [
        {
          reference: `Practitioner/${session.clinicianId}`,
        },
      ],
      date: session.clinicianSignature?.signedAt ?? new Date().toISOString(),
      content: [
        {
          attachment: {
            contentType: 'application/json',
            data: {
              soap: {
                subjective: soap.subjective,
                objective: soap.objective,
                assessment: soap.assessment,
                plan: soap.plan,
              },
              icdCodes: soap.icdCodes,
              cptCodes: soap.cptCodes,
              medicationChanges: soap.medicationChanges,
              followUp: soap.followUp,
            },
          },
        },
      ],
      context: {
        encounter: {
          reference: `Encounter/${session.sessionId}`,
        },
        period: {
          start: session.createdAt,
          end: session.clinicianSignature?.signedAt ?? session.updatedAt,
        },
      },
      // MediHive extensions
      extension: [
        {
          url: 'https://medihive.io/fhir/extension/transcript-segments',
          valueInteger: session.transcript.length,
        },
        {
          url: 'https://medihive.io/fhir/extension/clinical-entities',
          valueInteger: session.entities.length,
        },
        {
          url: 'https://medihive.io/fhir/extension/ai-model',
          valueString: 'claude-sonnet-4-20250514',
        },
        {
          url: 'https://medihive.io/fhir/extension/clinician-attestation',
          valueBoolean: soap.reviewStatus === 'signed',
        },
      ],
    };
  }

  /**
   * Hash ICD codes for on-chain storage (deterministic, sorted).
   */
  private hashIcdCodes(icdCodes: Array<{ code: string; display: string }>): Uint8Array {
    if (icdCodes.length === 0) {
      return new Uint8Array(32); // zero hash
    }

    const sorted = icdCodes
      .map((c) => c.code)
      .sort()
      .join('|');

    return new Uint8Array(
      createHash('sha256').update(sorted).digest()
    );
  }
}
