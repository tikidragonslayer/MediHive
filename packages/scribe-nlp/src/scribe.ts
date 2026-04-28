import { randomUUID } from 'crypto';
import { SOAPGenerator } from './soap-generator';
import { EntityExtractor } from './entity-extractor';
import {
  TranscriptSegment,
  ClinicalEntity,
  SOAPNote,
  ScribeSession,
} from './types';
/** Patient context summary from FHIR records */
interface PatientSummary {
  demographics?: { name: string; gender: string; birthDate: string; mrn: string };
  activeConditions: Array<{ code: string; display: string; onset: string }>;
  currentMedications: Array<{ name: string; dosage: string }>;
  allergies: Array<{ substance: string; severity: string }>;
  latestVitals: Record<string, { value: string; date: string }>;
  recentLabs: Array<{ name: string; value: string; date: string }>;
}

/**
 * MediScribe — Orchestrates the voice-to-chart pipeline.
 *
 * Full pipeline:
 * 1. Audio capture (handled by scribe-asr package / Whisper)
 * 2. Speaker diarization (pyannote.audio on edge GPU)
 * 3. Medical NLP entity extraction
 * 4. Patient context retrieval (from NFT via MediBridge)
 * 5. SOAP note generation (Claude API)
 * 6. Clinician review and sign-off
 * 7. Record minting on Solana
 *
 * For the prototype, steps 1-2 are simulated with pre-recorded transcripts.
 * Steps 3-7 are fully functional.
 */
export class MediScribe {
  private soapGenerator: SOAPGenerator;
  private entityExtractor: EntityExtractor;
  private activeSessions: Map<string, ScribeSession> = new Map();

  constructor(anthropicApiKey?: string) {
    this.soapGenerator = new SOAPGenerator(anthropicApiKey);
    this.entityExtractor = new EntityExtractor(anthropicApiKey);
  }

  /** Start a new scribe session */
  startSession(patientId: string, clinicianId: string): string {
    const sessionId = randomUUID();
    const session: ScribeSession = {
      sessionId,
      patientId,
      clinicianId,
      startTime: new Date().toISOString(),
      transcript: [],
      entities: [],
      consentVerified: false,
      aiModelUsed: 'claude-sonnet-4-20250514',
      clinicianEditCount: 0,
    };
    this.activeSessions.set(sessionId, session);
    return sessionId;
  }

  /** Record consent for ambient recording */
  verifyConsent(sessionId: string): void {
    const session = this.getSession(sessionId);
    session.consentVerified = true;
  }

  /** Add a transcript segment (from ASR / Whisper) */
  async addTranscriptSegment(sessionId: string, segment: TranscriptSegment): Promise<void> {
    const session = this.getSession(sessionId);
    if (!session.consentVerified) {
      throw new Error('Recording consent not verified for this session');
    }
    session.transcript.push(segment);

    // Extract clinical entities from the new segment
    const result = await this.entityExtractor.extractFromSegments([segment]);
    session.entities.push(...result.entities);
  }

  /** Process a complete transcript (for prototype — batch mode) */
  async addFullTranscript(sessionId: string, segments: TranscriptSegment[]): Promise<void> {
    const session = this.getSession(sessionId);
    if (!session.consentVerified) {
      throw new Error('Recording consent not verified for this session');
    }
    session.transcript = segments;

    // Extract all entities across segments with deduplication
    const result = await this.entityExtractor.extractFromSegments(segments);
    session.entities = result.entities;
  }

  /** Generate SOAP note from the session transcript */
  async generateNote(
    sessionId: string,
    patientContext?: PatientSummary
  ): Promise<SOAPNote> {
    const session = this.getSession(sessionId);

    if (session.transcript.length === 0) {
      throw new Error('No transcript data in session');
    }

    const soapNote = await this.soapGenerator.generateSOAPNote(
      session.transcript,
      session.entities,
      patientContext
    );

    session.soapNote = soapNote;
    return soapNote;
  }

  /** Clinician signs off on the note (changes status from draft to signed) */
  signNote(sessionId: string): SOAPNote {
    const session = this.getSession(sessionId);
    if (!session.soapNote) {
      throw new Error('No SOAP note generated for this session');
    }
    session.soapNote.reviewStatus = 'signed';
    session.endTime = new Date().toISOString();
    return session.soapNote;
  }

  /** Get the full session data */
  getSessionData(sessionId: string): ScribeSession {
    return this.getSession(sessionId);
  }

  /** End and cleanup a session */
  endSession(sessionId: string): ScribeSession {
    const session = this.getSession(sessionId);
    session.endTime = new Date().toISOString();
    this.activeSessions.delete(sessionId);
    return session;
  }

  // === Private helpers ===

  private getSession(sessionId: string): ScribeSession {
    const session = this.activeSessions.get(sessionId);
    if (!session) throw new Error(`Session not found: ${sessionId}`);
    return session;
  }

}
