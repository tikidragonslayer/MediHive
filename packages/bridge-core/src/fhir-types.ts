/**
 * FHIR R4 type definitions for MediBridge.
 * Simplified subset covering the resources we need for the prototype.
 */

export interface FHIRBundle {
  resourceType: 'Bundle';
  id?: string;
  type: 'collection' | 'searchset' | 'transaction' | 'document';
  total?: number;
  entry?: FHIRBundleEntry[];
}

export interface FHIRBundleEntry {
  fullUrl?: string;
  resource: FHIRResource;
}

export type FHIRResource =
  | FHIRPatient
  | FHIRObservation
  | FHIRCondition
  | FHIRMedicationRequest
  | FHIRDocumentReference
  | FHIREncounter
  | FHIRDiagnosticReport
  | FHIRAllergyIntolerance;

// === Patient ===

export interface FHIRPatient {
  resourceType: 'Patient';
  id?: string;
  identifier?: FHIRIdentifier[];
  name?: FHIRHumanName[];
  gender?: 'male' | 'female' | 'other' | 'unknown';
  birthDate?: string;
  address?: FHIRAddress[];
  telecom?: FHIRContactPoint[];
}

// === Observation (vitals, labs) ===

export interface FHIRObservation {
  resourceType: 'Observation';
  id?: string;
  status: 'registered' | 'preliminary' | 'final' | 'amended';
  category?: FHIRCodeableConcept[];
  code: FHIRCodeableConcept;
  subject?: FHIRReference;
  effectiveDateTime?: string;
  valueQuantity?: { value: number; unit: string; system?: string; code?: string };
  valueString?: string;
  component?: Array<{
    code: FHIRCodeableConcept;
    valueQuantity?: { value: number; unit: string };
  }>;
}

// === Condition (diagnoses) ===

export interface FHIRCondition {
  resourceType: 'Condition';
  id?: string;
  clinicalStatus?: FHIRCodeableConcept;
  code?: FHIRCodeableConcept;
  subject: FHIRReference;
  onsetDateTime?: string;
  recordedDate?: string;
}

// === MedicationRequest ===

export interface FHIRMedicationRequest {
  resourceType: 'MedicationRequest';
  id?: string;
  status: 'active' | 'completed' | 'stopped' | 'cancelled';
  medicationCodeableConcept?: FHIRCodeableConcept;
  subject: FHIRReference;
  authoredOn?: string;
  dosageInstruction?: Array<{
    text?: string;
    timing?: { repeat?: { frequency?: number; period?: number; periodUnit?: string } };
    doseAndRate?: Array<{ doseQuantity?: { value: number; unit: string } }>;
  }>;
}

// === DocumentReference (clinical notes) ===

export interface FHIRDocumentReference {
  resourceType: 'DocumentReference';
  id?: string;
  status: 'current' | 'superseded';
  type?: FHIRCodeableConcept;
  subject?: FHIRReference;
  date?: string;
  author?: FHIRReference[];
  content: Array<{
    attachment: { contentType?: string; data?: string; url?: string; title?: string };
  }>;
}

// === Encounter ===

export interface FHIREncounter {
  resourceType: 'Encounter';
  id?: string;
  status: 'planned' | 'arrived' | 'in-progress' | 'finished' | 'cancelled';
  class: FHIRCoding;
  subject?: FHIRReference;
  period?: { start?: string; end?: string };
  reasonCode?: FHIRCodeableConcept[];
  participant?: Array<{ individual?: FHIRReference; type?: FHIRCodeableConcept[] }>;
}

// === DiagnosticReport (imaging, pathology) ===

export interface FHIRDiagnosticReport {
  resourceType: 'DiagnosticReport';
  id?: string;
  status: 'registered' | 'partial' | 'preliminary' | 'final';
  category?: FHIRCodeableConcept[];
  code: FHIRCodeableConcept;
  subject?: FHIRReference;
  effectiveDateTime?: string;
  conclusion?: string;
  presentedForm?: Array<{ contentType?: string; url?: string; title?: string }>;
}

// === AllergyIntolerance ===

export interface FHIRAllergyIntolerance {
  resourceType: 'AllergyIntolerance';
  id?: string;
  clinicalStatus?: FHIRCodeableConcept;
  code?: FHIRCodeableConcept;
  patient: FHIRReference;
  recordedDate?: string;
  reaction?: Array<{
    substance?: FHIRCodeableConcept;
    manifestation: FHIRCodeableConcept[];
    severity?: 'mild' | 'moderate' | 'severe';
  }>;
}

// === Common Types ===

export interface FHIRIdentifier {
  system?: string;
  value?: string;
  type?: FHIRCodeableConcept;
}

export interface FHIRHumanName {
  family?: string;
  given?: string[];
  prefix?: string[];
  suffix?: string[];
  text?: string;
}

export interface FHIRAddress {
  line?: string[];
  city?: string;
  state?: string;
  postalCode?: string;
  country?: string;
}

export interface FHIRContactPoint {
  system?: 'phone' | 'email' | 'fax';
  value?: string;
  use?: 'home' | 'work' | 'mobile';
}

export interface FHIRCodeableConcept {
  coding?: FHIRCoding[];
  text?: string;
}

export interface FHIRCoding {
  system?: string;
  code?: string;
  display?: string;
}

export interface FHIRReference {
  reference?: string;
  display?: string;
}
