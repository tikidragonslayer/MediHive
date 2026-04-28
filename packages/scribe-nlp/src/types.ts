export interface TranscriptSegment {
  speaker: 'doctor' | 'nurse' | 'patient' | 'unknown';
  text: string;
  startTime: number;
  endTime: number;
  confidence: number;
}

export interface ClinicalEntity {
  type: 'symptom' | 'medication' | 'dosage' | 'vital' | 'procedure' | 'diagnosis' | 'allergy' | 'lab_order';
  text: string;
  normalized?: string;
  code?: string;
  codeSystem?: 'ICD-10' | 'SNOMED-CT' | 'RxNorm' | 'LOINC' | 'CPT';
  confidence: number;
}

export interface SOAPNote {
  subjective: string;
  objective: string;
  assessment: string;
  plan: string;
  icdCodes: Array<{ code: string; display: string }>;
  cptCodes: Array<{ code: string; display: string }>;
  medicationChanges: Array<{ action: 'start' | 'stop' | 'adjust'; medication: string; details: string }>;
  followUp?: string;
  generatedAt: string;
  reviewStatus: 'draft' | 'reviewed' | 'signed';
  editHistory: NoteEdit[];
}

export interface NoteEdit {
  field: 'subjective' | 'objective' | 'assessment' | 'plan' | 'icdCodes' | 'cptCodes' | 'medicationChanges';
  oldValue: string;
  newValue: string;
  editedBy: string;
  editedAt: string;
  reason?: string;
}

export interface ScribeSession {
  sessionId: string;
  patientId: string;
  clinicianId: string;
  startTime: string;
  endTime?: string;
  transcript: TranscriptSegment[];
  entities: ClinicalEntity[];
  soapNote?: SOAPNote;
  consentVerified: boolean;
  aiModelUsed: string;
  aiGeneratedAt?: string;
  clinicianEditCount: number;
}
