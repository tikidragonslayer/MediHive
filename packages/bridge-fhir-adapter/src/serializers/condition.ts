/**
 * Condition serializer: bidirectional conversion between FHIR Condition and MediHive ConditionData.
 */

import type { FHIRCondition, FHIRCodeableConcept } from '../../../bridge-core/src/fhir-types';
import type { ConditionData, MediHiveRecord } from '../types';
import { ICD10_SYSTEM, FHIR_CONDITION_CLINICAL_STATUS_SYSTEM } from '../types';

type ClinicalStatus = ConditionData['clinicalStatus'];

const VALID_CLINICAL_STATUSES: ClinicalStatus[] = [
  'active', 'resolved', 'inactive', 'recurrence', 'relapse', 'remission',
];

/**
 * Extract clinical status string from a FHIRCodeableConcept.
 */
function extractClinicalStatus(concept: FHIRCodeableConcept | undefined): ClinicalStatus {
  if (!concept) return 'active';
  const code = concept.coding?.[0]?.code ?? concept.text ?? 'active';
  return VALID_CLINICAL_STATUSES.includes(code as ClinicalStatus)
    ? (code as ClinicalStatus)
    : 'active';
}

/**
 * Extract the primary code and system from a CodeableConcept.
 */
function extractCode(concept: FHIRCodeableConcept | undefined): {
  code: string;
  system: string;
  display: string;
} {
  if (!concept) return { code: '', system: '', display: '' };

  // Prefer ICD-10
  const icd10 = concept.coding?.find((c) => c.system === ICD10_SYSTEM);
  if (icd10) {
    return {
      code: icd10.code ?? '',
      system: ICD10_SYSTEM,
      display: icd10.display ?? concept.text ?? '',
    };
  }

  const first = concept.coding?.[0];
  return {
    code: first?.code ?? '',
    system: first?.system ?? '',
    display: first?.display ?? concept.text ?? '',
  };
}

/**
 * Convert a FHIR Condition resource to MediHive ConditionData.
 */
export function fromFHIR(resource: FHIRCondition): ConditionData {
  const { code, system, display } = extractCode(resource.code);
  const clinicalStatus = extractClinicalStatus(resource.clinicalStatus);

  return {
    recordType: 'condition',
    code,
    codeSystem: system,
    codeDisplay: display,
    clinicalStatus,
    onsetDate: resource.onsetDateTime,
    recordedDate: resource.recordedDate,
  };
}

/**
 * Convert MediHive ConditionData (from a MediHiveRecord) to a FHIR Condition resource.
 */
export function toFHIR(record: MediHiveRecord): FHIRCondition {
  const data = record.data as ConditionData;

  return {
    resourceType: 'Condition',
    id: record.sourceId || undefined,
    clinicalStatus: {
      coding: [
        {
          system: FHIR_CONDITION_CLINICAL_STATUS_SYSTEM,
          code: data.clinicalStatus,
          display: data.clinicalStatus.charAt(0).toUpperCase() + data.clinicalStatus.slice(1),
        },
      ],
    },
    code: {
      coding: [
        {
          system: data.codeSystem || ICD10_SYSTEM,
          code: data.code,
          display: data.codeDisplay,
        },
      ],
      text: data.codeDisplay,
    },
    subject: { reference: `Patient/${record.patientId}` },
    onsetDateTime: data.onsetDate,
    recordedDate: data.recordedDate,
  };
}
