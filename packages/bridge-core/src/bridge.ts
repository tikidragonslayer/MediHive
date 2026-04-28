import { FHIRClient, FHIRClientConfig } from './fhir-client';
import { FHIRTransformer, PatientSummary } from './fhir-transformer';
import { FHIRBundle } from './fhir-types';
import { createHash, createCipheriv, randomBytes } from 'crypto';

/** Inline encryption for bridge (avoids cross-package import issues in monorepo) */
function encryptForIPFS(plaintext: string, key: Uint8Array): { encryptedPayload: string; contentHash: string } {
  const data = Buffer.from(plaintext, 'utf8');
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
  const tag = cipher.getAuthTag();
  const hash = createHash('sha256').update(data).digest();
  const payload = { v: 1, alg: 'AES-256-GCM', ct: encrypted.toString('base64'), nonce: nonce.toString('base64'), tag: tag.toString('base64') };
  return { encryptedPayload: JSON.stringify(payload), contentHash: hash.toString('hex') };
}

/**
 * MediBridge — The integration layer between EHR systems and MediVault blockchain.
 *
 * Workflow:
 * 1. Pull patient data from EHR via FHIR R4
 * 2. Transform to MediVault schema
 * 3. Encrypt with patient's key
 * 4. Store on IPFS
 * 5. Mint Record NFT on Solana
 *
 * For the prototype, this handles one-way sync (EHR → blockchain).
 * Phase 2 adds bidirectional sync.
 */
export class MediBridge {
  private fhirClient: FHIRClient;

  constructor(fhirConfig: FHIRClientConfig) {
    this.fhirClient = new FHIRClient(fhirConfig);
  }

  /** Import a complete patient record from EHR to blockchain */
  async importPatientRecord(
    ehrPatientId: string,
    patientEncryptionKey: Uint8Array
  ): Promise<ImportResult> {
    // 1. Fetch complete record from EHR
    const bundle = await this.fhirClient.getCompletePatientRecord(ehrPatientId);

    if (!bundle.entry || bundle.entry.length === 0) {
      return { success: false, error: 'No patient data found in EHR', records: [] };
    }

    // 2. Extract patient summary for MediBrain context
    const summary = FHIRTransformer.extractPatientSummary(bundle);

    // 3. Hash the bundle for on-chain integrity
    const contentHash = FHIRTransformer.hashBundle(bundle);

    // 4. Extract ICD codes
    const icdCodes = FHIRTransformer.extractICDCodes(bundle);
    const icdCodesHash = FHIRTransformer.hashICDCodes(icdCodes);

    // 5. Encrypt the full FHIR bundle
    const bundleJson = FHIRTransformer.bundleToJSON(bundle);
    const { encryptedPayload } = encryptForIPFS(
      bundleJson,
      patientEncryptionKey
    );

    // 6. In production: upload to IPFS and mint Record NFT
    // For prototype: return the prepared data
    return {
      success: true,
      records: [
        {
          fhirBundle: bundle,
          patientSummary: summary,
          contentHash: Buffer.from(contentHash).toString('hex'),
          icdCodes,
          icdCodesHash: Buffer.from(icdCodesHash).toString('hex'),
          encryptedPayload,
          resourceCount: bundle.entry.length,
        },
      ],
    };
  }

  /** Fetch patient summary for MediBrain/MediScribe context */
  async getPatientContext(ehrPatientId: string): Promise<PatientSummary | null> {
    const bundle = await this.fhirClient.getCompletePatientRecord(ehrPatientId);
    if (!bundle.entry || bundle.entry.length === 0) return null;
    return FHIRTransformer.extractPatientSummary(bundle);
  }

  /** Sync a single new observation (e.g., new lab result) from EHR */
  async syncObservation(
    ehrPatientId: string,
    observationId: string,
    patientEncryptionKey: Uint8Array
  ): Promise<ImportResult> {
    const observations = await this.fhirClient.getPatientObservations(ehrPatientId);
    const target = observations.entry?.find(
      (e) => e.resource.id === observationId
    );

    if (!target) {
      return { success: false, error: 'Observation not found', records: [] };
    }

    const singleBundle: FHIRBundle = {
      resourceType: 'Bundle',
      type: 'collection',
      total: 1,
      entry: [target],
    };

    const contentHash = FHIRTransformer.hashBundle(singleBundle);
    const json = FHIRTransformer.bundleToJSON(singleBundle);
    const { encryptedPayload } = encryptForIPFS(
      json,
      patientEncryptionKey
    );

    const recordType = FHIRTransformer.mapResourceToRecordType('Observation');

    return {
      success: true,
      records: [
        {
          fhirBundle: singleBundle,
          contentHash: Buffer.from(contentHash).toString('hex'),
          icdCodes: [],
          icdCodesHash: Buffer.alloc(32).toString('hex'),
          encryptedPayload,
          resourceCount: 1,
          recordType,
        },
      ],
    };
  }
}

// === Types ===

export interface ImportResult {
  success: boolean;
  error?: string;
  records: ImportedRecord[];
}

export interface ImportedRecord {
  fhirBundle: FHIRBundle;
  patientSummary?: PatientSummary;
  contentHash: string;
  icdCodes: string[];
  icdCodesHash: string;
  encryptedPayload: string;
  resourceCount: number;
  recordType?: number;
}
