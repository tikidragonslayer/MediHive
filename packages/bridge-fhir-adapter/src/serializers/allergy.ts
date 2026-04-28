/**
 * AllergyIntolerance serializer: bidirectional conversion between
 * FHIR AllergyIntolerance and MediHive AllergyData.
 */

import type { FHIRAllergyIntolerance, FHIRCodeableConcept } from '../../../bridge-core/src/fhir-types';
import type { AllergyData, MediHiveRecord } from '../types';
import { SNOMED_SYSTEM, FHIR_ALLERGY_CLINICAL_STATUS_SYSTEM } from '../types';

/**
 * Extract a human-readable display string from a CodeableConcept.
 */
function conceptToDisplay(concept: FHIRCodeableConcept | undefined): string {
  if (!concept) return '';
  return concept.coding?.[0]?.display ?? concept.text ?? '';
}

/**
 * Convert a FHIR AllergyIntolerance resource to MediHive AllergyData.
 */
export function fromFHIR(resource: FHIRAllergyIntolerance): AllergyData {
  const substanceCoding = resource.code?.coding?.[0];

  const reactions = (resource.reaction ?? []).map((reaction) => ({
    substance: conceptToDisplay(reaction.substance),
    manifestations: reaction.manifestation.map(
      (m) => m.coding?.[0]?.display ?? m.text ?? 'Unknown'
    ),
    severity: reaction.severity,
  }));

  return {
    recordType: 'allergy',
    substanceCode: substanceCoding?.code,
    substanceSystem: substanceCoding?.system,
    substanceDisplay:
      substanceCoding?.display ?? resource.code?.text ?? 'Unknown allergen',
    clinicalStatus:
      resource.clinicalStatus?.coding?.[0]?.code ??
      resource.clinicalStatus?.text ??
      'active',
    recordedDate: resource.recordedDate,
    reactions,
  };
}

/**
 * Convert MediHive AllergyData (from a MediHiveRecord) to a FHIR AllergyIntolerance resource.
 */
export function toFHIR(record: MediHiveRecord): FHIRAllergyIntolerance {
  const data = record.data as AllergyData;

  const reaction: FHIRAllergyIntolerance['reaction'] = data.reactions.map((r) => ({
    substance: r.substance
      ? {
          coding: [{ system: SNOMED_SYSTEM, display: r.substance }],
          text: r.substance,
        }
      : undefined,
    manifestation: r.manifestations.map((m) => ({
      coding: [{ system: SNOMED_SYSTEM, display: m }],
      text: m,
    })),
    severity: r.severity,
  }));

  return {
    resourceType: 'AllergyIntolerance',
    id: record.sourceId || undefined,
    clinicalStatus: {
      coding: [
        {
          system: FHIR_ALLERGY_CLINICAL_STATUS_SYSTEM,
          code: data.clinicalStatus,
          display:
            data.clinicalStatus.charAt(0).toUpperCase() + data.clinicalStatus.slice(1),
        },
      ],
    },
    code: {
      coding: [
        {
          system: data.substanceSystem ?? SNOMED_SYSTEM,
          code: data.substanceCode,
          display: data.substanceDisplay,
        },
      ],
      text: data.substanceDisplay,
    },
    patient: { reference: `Patient/${record.patientId}` },
    recordedDate: data.recordedDate,
    reaction: reaction.length > 0 ? reaction : undefined,
  };
}
