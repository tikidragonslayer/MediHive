/**
 * Encounter serializer: bidirectional conversion between
 * FHIR Encounter and MediHive EncounterData.
 */

import type { FHIREncounter, FHIRCodeableConcept } from '../../../bridge-core/src/fhir-types';
import type { EncounterData, MediHiveRecord } from '../types';
import { FHIR_ENCOUNTER_CLASS_SYSTEM } from '../types';

/**
 * Convert a FHIR Encounter resource to MediHive EncounterData.
 */
export function fromFHIR(resource: FHIREncounter): EncounterData {
  const reasonCodes = (resource.reasonCode ?? []).map((rc: FHIRCodeableConcept) => ({
    code: rc.coding?.[0]?.code,
    display: rc.coding?.[0]?.display ?? rc.text,
  }));

  const participants = (resource.participant ?? []).map((p) => ({
    role: p.type?.[0]?.coding?.[0]?.display ?? p.type?.[0]?.text,
    name: p.individual?.display,
    reference: p.individual?.reference,
  }));

  return {
    recordType: 'encounter',
    status: resource.status,
    encounterClass: resource.class.code ?? '',
    classDisplay: resource.class.display,
    periodStart: resource.period?.start,
    periodEnd: resource.period?.end,
    reasonCodes,
    participants,
  };
}

/**
 * Convert MediHive EncounterData (from a MediHiveRecord) to a FHIR Encounter resource.
 */
export function toFHIR(record: MediHiveRecord): FHIREncounter {
  const data = record.data as EncounterData;
  const status = data.status as FHIREncounter['status'];

  const reasonCode: FHIRCodeableConcept[] | undefined =
    data.reasonCodes.length > 0
      ? data.reasonCodes.map((rc) => ({
          coding: rc.code ? [{ code: rc.code, display: rc.display }] : undefined,
          text: rc.display,
        }))
      : undefined;

  const participant: FHIREncounter['participant'] =
    data.participants.length > 0
      ? data.participants.map((p) => ({
          type: p.role
            ? [{ coding: [{ display: p.role }], text: p.role }]
            : undefined,
          individual: p.reference || p.name
            ? { reference: p.reference, display: p.name }
            : undefined,
        }))
      : undefined;

  return {
    resourceType: 'Encounter',
    id: record.sourceId || undefined,
    status,
    class: {
      system: FHIR_ENCOUNTER_CLASS_SYSTEM,
      code: data.encounterClass,
      display: data.classDisplay,
    },
    subject: { reference: `Patient/${record.patientId}` },
    period:
      data.periodStart || data.periodEnd
        ? { start: data.periodStart, end: data.periodEnd }
        : undefined,
    reasonCode,
    participant,
  };
}
