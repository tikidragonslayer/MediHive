/**
 * FHIR R4 coding system constants and MediHive internal record types.
 */

// ─── LOINC Vital Sign Codes ─────────────────────────────────────────────────

export const LOINC_SYSTEM = 'http://loinc.org' as const;

export const LOINC_VITALS = {
  HEART_RATE: '8867-4',
  BLOOD_PRESSURE_SYSTOLIC: '8480-6',
  BLOOD_PRESSURE_DIASTOLIC: '8462-4',
  BLOOD_PRESSURE_PANEL: '85354-9',
  TEMPERATURE: '8310-5',
  SPO2: '59408-5',
  RESPIRATORY_RATE: '9279-1',
  PAIN_LEVEL: '72514-3',
  BODY_WEIGHT: '29463-7',
  BODY_HEIGHT: '8302-2',
  BMI: '39156-5',
} as const;

export const LOINC_VITALS_DISPLAY: Record<string, string> = {
  [LOINC_VITALS.HEART_RATE]: 'Heart rate',
  [LOINC_VITALS.BLOOD_PRESSURE_SYSTOLIC]: 'Systolic blood pressure',
  [LOINC_VITALS.BLOOD_PRESSURE_DIASTOLIC]: 'Diastolic blood pressure',
  [LOINC_VITALS.BLOOD_PRESSURE_PANEL]: 'Blood pressure panel',
  [LOINC_VITALS.TEMPERATURE]: 'Body temperature',
  [LOINC_VITALS.SPO2]: 'Oxygen saturation',
  [LOINC_VITALS.RESPIRATORY_RATE]: 'Respiratory rate',
  [LOINC_VITALS.PAIN_LEVEL]: 'Pain severity',
  [LOINC_VITALS.BODY_WEIGHT]: 'Body weight',
  [LOINC_VITALS.BODY_HEIGHT]: 'Body height',
  [LOINC_VITALS.BMI]: 'Body mass index',
};

// ─── LOINC Document Type Codes ──────────────────────────────────────────────

export const LOINC_DOCUMENT_TYPES = {
  PROGRESS_NOTE: '11506-3',
  DISCHARGE_SUMMARY: '18842-5',
  HISTORY_AND_PHYSICAL: '34117-2',
  CONSULTATION_NOTE: '11488-4',
  OPERATIVE_NOTE: '11504-8',
  SOAP_NOTE: '34109-9',
} as const;

// ─── LOINC Lab Categories ───────────────────────────────────────────────────

export const LOINC_LAB_CATEGORIES = {
  CBC: '58410-2',
  BMP: '51990-0',
  CMP: '24323-8',
  LIPID_PANEL: '57698-3',
  URINALYSIS: '24357-6',
  HBA1C: '4548-4',
} as const;

// ─── ICD-10 Common Codes ────────────────────────────────────────────────────

export const ICD10_SYSTEM = 'http://hl7.org/fhir/sid/icd-10-cm' as const;

export const ICD10_COMMON = {
  // Cardiovascular
  ESSENTIAL_HYPERTENSION: 'I10',
  TYPE_2_DIABETES: 'E11.9',
  HYPERLIPIDEMIA: 'E78.5',
  ATRIAL_FIBRILLATION: 'I48.91',
  HEART_FAILURE: 'I50.9',
  // Respiratory
  ASTHMA: 'J45.909',
  COPD: 'J44.1',
  PNEUMONIA: 'J18.9',
  COVID_19: 'U07.1',
  // Musculoskeletal
  LOW_BACK_PAIN: 'M54.5',
  OSTEOARTHRITIS_KNEE: 'M17.9',
  // Mental health
  MAJOR_DEPRESSIVE_DISORDER: 'F32.9',
  GENERALIZED_ANXIETY: 'F41.1',
  // Other common
  ANEMIA: 'D64.9',
  HYPOTHYROIDISM: 'E03.9',
  GERD: 'K21.0',
  CHRONIC_KIDNEY_DISEASE: 'N18.9',
} as const;

// ─── SNOMED CT ──────────────────────────────────────────────────────────────

export const SNOMED_SYSTEM = 'http://snomed.info/sct' as const;

export const SNOMED_COMMON = {
  // Encounter classes
  AMBULATORY: '371883000',
  EMERGENCY: '50849002',
  INPATIENT: '32485007',
  // Clinical findings
  FEVER: '386661006',
  COUGH: '49727002',
  HEADACHE: '25064002',
  CHEST_PAIN: '29857009',
  // Allergy substances
  PENICILLIN: '764146007',
  ASPIRIN: '387458008',
  LATEX: '111088007',
  PEANUT: '762952008',
  // Reaction manifestations
  ANAPHYLAXIS: '39579001',
  URTICARIA: '126485001',
  RASH: '271807003',
  NAUSEA: '422587007',
  DYSPNEA: '267036007',
} as const;

// ─── RxNorm ─────────────────────────────────────────────────────────────────

export const RXNORM_SYSTEM = 'http://www.nlm.nih.gov/research/umls/rxnorm' as const;

// ─── FHIR Value Sets & Code Systems ─────────────────────────────────────────

export const FHIR_IDENTIFIER_SYSTEMS = {
  MRN: 'http://hl7.org/fhir/sid/us-mrn',
  SSN: 'http://hl7.org/fhir/sid/us-ssn',
  NPI: 'http://hl7.org/fhir/sid/us-npi',
} as const;

export const FHIR_OBSERVATION_CATEGORIES = {
  VITAL_SIGNS: 'vital-signs',
  LABORATORY: 'laboratory',
  IMAGING: 'imaging',
  SOCIAL_HISTORY: 'social-history',
} as const;

export const FHIR_OBSERVATION_CATEGORY_SYSTEM =
  'http://terminology.hl7.org/CodeSystem/observation-category' as const;

export const FHIR_CONDITION_CLINICAL_STATUS_SYSTEM =
  'http://terminology.hl7.org/CodeSystem/condition-clinical' as const;

export const FHIR_ALLERGY_CLINICAL_STATUS_SYSTEM =
  'http://terminology.hl7.org/CodeSystem/allergyintolerance-clinical' as const;

export const FHIR_ENCOUNTER_CLASS_SYSTEM =
  'http://terminology.hl7.org/CodeSystem/v3-ActCode' as const;

export const FHIR_DIAGNOSTIC_CATEGORY_SYSTEM =
  'http://terminology.hl7.org/CodeSystem/v2-0074' as const;

// ─── MediHive Internal Record Types ─────────────────────────────────────────

export type MediHiveRecordType =
  | 'patient'
  | 'vitals'
  | 'condition'
  | 'medication'
  | 'allergy'
  | 'encounter'
  | 'document'
  | 'diagnostic-report';

/**
 * Core internal record format for MediHive.
 * This is what gets encrypted, stored on IPFS, and anchored on Solana.
 */
export interface MediHiveRecord {
  /** Unique record identifier (UUID v4) */
  id: string;
  /** Record type discriminator */
  type: MediHiveRecordType;
  /** Patient this record belongs to (MediHive patient ID) */
  patientId: string;
  /** Source EHR system identifier (e.g. 'epic', 'cerner') */
  sourceSystem: string;
  /** Original resource ID in the source EHR */
  sourceId: string;
  /** ISO 8601 timestamp of when this record was created in MediHive */
  createdAt: string;
  /** ISO 8601 timestamp of the last update */
  updatedAt: string;
  /** ISO 8601 timestamp from the source EHR (effectiveDateTime, recordedDate, etc.) */
  clinicalDate: string;
  /** The actual clinical data payload (type-specific) */
  data: MediHiveRecordData;
  /** Optional IPFS CID once persisted */
  ipfsCid?: string;
  /** Optional Solana transaction signature once anchored */
  solanaTxSignature?: string;
  /** Version for optimistic concurrency */
  version: number;
}

// ─── Type-specific data payloads ────────────────────────────────────────────

export type MediHiveRecordData =
  | PatientData
  | VitalsData
  | ConditionData
  | MedicationData
  | AllergyData
  | EncounterData
  | DocumentData
  | DiagnosticReportData;

export interface PatientData {
  recordType: 'patient';
  mrn?: string;
  firstName: string;
  lastName: string;
  displayName: string;
  gender?: string;
  birthDate?: string;
  address?: {
    line?: string[];
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
  phone?: string;
  email?: string;
}

export interface VitalsData {
  recordType: 'vitals';
  code: string;
  codeDisplay: string;
  value?: number;
  unit?: string;
  components?: Array<{
    code: string;
    codeDisplay: string;
    value: number;
    unit: string;
  }>;
  status: string;
}

export interface ConditionData {
  recordType: 'condition';
  code: string;
  codeSystem: string;
  codeDisplay: string;
  clinicalStatus: 'active' | 'resolved' | 'inactive' | 'recurrence' | 'relapse' | 'remission';
  onsetDate?: string;
  recordedDate?: string;
}

export interface MedicationData {
  recordType: 'medication';
  medicationCode?: string;
  medicationSystem?: string;
  medicationDisplay: string;
  status: string;
  authoredOn?: string;
  dosageInstructions?: Array<{
    text?: string;
    frequency?: number;
    period?: number;
    periodUnit?: string;
    doseValue?: number;
    doseUnit?: string;
    route?: string;
  }>;
}

export interface AllergyData {
  recordType: 'allergy';
  substanceCode?: string;
  substanceSystem?: string;
  substanceDisplay: string;
  clinicalStatus: string;
  recordedDate?: string;
  reactions: Array<{
    substance?: string;
    manifestations: string[];
    severity?: 'mild' | 'moderate' | 'severe';
  }>;
}

export interface EncounterData {
  recordType: 'encounter';
  status: string;
  encounterClass: string;
  classDisplay?: string;
  periodStart?: string;
  periodEnd?: string;
  reasonCodes: Array<{ code?: string; display?: string }>;
  participants: Array<{ role?: string; name?: string; reference?: string }>;
}

export interface DocumentData {
  recordType: 'document';
  status: string;
  docType?: string;
  docTypeCode?: string;
  date?: string;
  authors: string[];
  contentType?: string;
  contentBase64?: string;
  contentUrl?: string;
  title?: string;
}

export interface DiagnosticReportData {
  recordType: 'diagnostic-report';
  status: string;
  category?: string;
  code: string;
  codeDisplay: string;
  effectiveDate?: string;
  conclusion?: string;
  presentedForms: Array<{
    contentType?: string;
    url?: string;
    title?: string;
  }>;
}

// ─── Patient Summary (composite type for MediScribe) ────────────────────────

export interface PatientSummary {
  patient: PatientData;
  vitals: VitalsData[];
  conditions: ConditionData[];
  medications: MedicationData[];
  allergies: AllergyData[];
  recentEncounters: EncounterData[];
  recentDocuments: DocumentData[];
  recentReports: DiagnosticReportData[];
  lastSyncedAt: string;
}

// ─── EHR Connection Config ──────────────────────────────────────────────────

export interface EHRConfig {
  /** Base FHIR R4 endpoint URL */
  baseUrl: string;
  /** OAuth2 client ID for SMART on FHIR */
  clientId: string;
  /** OAuth2 client secret (confidential clients) */
  clientSecret?: string;
  /** OAuth2 token endpoint */
  tokenUrl: string;
  /** OAuth2 authorization endpoint (for user-facing flows) */
  authorizeUrl?: string;
  /** Requested FHIR scopes */
  scopes: string[];
  /** Tenant/organization ID if required */
  tenantId?: string;
  /** Additional headers to include in requests */
  additionalHeaders?: Record<string, string>;
}

// ─── Sync Engine Types ──────────────────────────────────────────────────────

export interface SyncOptions {
  /** Polling interval in milliseconds. Default: 300_000 (5 minutes) */
  intervalMs: number;
  /** Maximum number of resources to fetch per poll */
  batchSize: number;
  /** Resource types to sync */
  resourceTypes: MediHiveRecordType[];
  /** Only sync records updated after this date */
  sinceDate?: string;
}

export type SyncEventType =
  | 'sync:start'
  | 'sync:complete'
  | 'sync:error'
  | 'sync:resource-updated'
  | 'sync:conflict-resolved';

export interface SyncEvent {
  type: SyncEventType;
  timestamp: string;
  patientId?: string;
  resourceType?: MediHiveRecordType;
  resourceId?: string;
  details?: string;
  error?: string;
}

export type ConflictResolution = 'ehr-wins' | 'medihive-wins';

export interface ConflictPolicy {
  /** Demographics always defer to EHR */
  patient: ConflictResolution;
  /** Vitals defer to EHR (source of truth for live readings) */
  vitals: ConflictResolution;
  /** Conditions: EHR wins (clinician authority) */
  condition: ConflictResolution;
  /** Medications: EHR wins */
  medication: ConflictResolution;
  /** Allergies: EHR wins */
  allergy: ConflictResolution;
  /** Encounters: EHR wins */
  encounter: ConflictResolution;
  /** Documents: MediHive wins once blockchain-anchored */
  document: ConflictResolution;
  /** Diagnostic reports: EHR wins */
  'diagnostic-report': ConflictResolution;
}

export const DEFAULT_CONFLICT_POLICY: ConflictPolicy = {
  patient: 'ehr-wins',
  vitals: 'ehr-wins',
  condition: 'ehr-wins',
  medication: 'ehr-wins',
  allergy: 'ehr-wins',
  encounter: 'ehr-wins',
  document: 'medihive-wins',
  'diagnostic-report': 'ehr-wins',
};
