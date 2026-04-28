/**
 * Observation serializer: bidirectional conversion between FHIR Observation and MediHive VitalsData.
 */

import type { FHIRObservation, FHIRCodeableConcept } from '../../../bridge-core/src/fhir-types';
import type { VitalsData, MediHiveRecord } from '../types';
import {
  LOINC_SYSTEM,
  LOINC_VITALS,
  LOINC_VITALS_DISPLAY,
  FHIR_OBSERVATION_CATEGORY_SYSTEM,
  FHIR_OBSERVATION_CATEGORIES,
} from '../types';

/**
 * Extract the primary LOINC code from a CodeableConcept.
 */
function extractLoincCode(concept: FHIRCodeableConcept): { code: string; display: string } {
  const loincCoding = concept.coding?.find((c) => c.system === LOINC_SYSTEM);
  if (loincCoding) {
    return {
      code: loincCoding.code ?? '',
      display: loincCoding.display ?? concept.text ?? '',
    };
  }
  const firstCoding = concept.coding?.[0];
  return {
    code: firstCoding?.code ?? '',
    display: firstCoding?.display ?? concept.text ?? '',
  };
}

/**
 * Convert a FHIR Observation to MediHive VitalsData.
 */
export function fromFHIR(resource: FHIRObservation): VitalsData {
  const { code, display } = extractLoincCode(resource.code);

  const components = resource.component?.map((comp) => {
    const compCode = extractLoincCode(comp.code);
    return {
      code: compCode.code,
      codeDisplay: compCode.display,
      value: comp.valueQuantity?.value ?? 0,
      unit: comp.valueQuantity?.unit ?? '',
    };
  });

  return {
    recordType: 'vitals',
    code,
    codeDisplay: display || LOINC_VITALS_DISPLAY[code] || code,
    value: resource.valueQuantity?.value,
    unit: resource.valueQuantity?.unit,
    components,
    status: resource.status,
  };
}

/**
 * Check if a LOINC code represents blood pressure (which uses components).
 */
function isBloodPressureCode(code: string): boolean {
  return code === LOINC_VITALS.BLOOD_PRESSURE_PANEL;
}

/**
 * Build the vital signs category CodeableConcept.
 */
function buildVitalSignsCategory(): FHIRCodeableConcept[] {
  return [
    {
      coding: [
        {
          system: FHIR_OBSERVATION_CATEGORY_SYSTEM,
          code: FHIR_OBSERVATION_CATEGORIES.VITAL_SIGNS,
          display: 'Vital Signs',
        },
      ],
    },
  ];
}

/**
 * Convert MediHive VitalsData (from a MediHiveRecord) to a FHIR Observation resource.
 */
export function toFHIR(record: MediHiveRecord): FHIRObservation {
  const data = record.data as VitalsData;
  const status = data.status as FHIRObservation['status'];

  const observation: FHIRObservation = {
    resourceType: 'Observation',
    id: record.sourceId || undefined,
    status,
    category: buildVitalSignsCategory(),
    code: {
      coding: [
        {
          system: LOINC_SYSTEM,
          code: data.code,
          display: data.codeDisplay || LOINC_VITALS_DISPLAY[data.code],
        },
      ],
      text: data.codeDisplay,
    },
    subject: { reference: `Patient/${record.patientId}` },
    effectiveDateTime: record.clinicalDate,
  };

  // Blood pressure uses components instead of a top-level value
  if (isBloodPressureCode(data.code) && data.components) {
    observation.component = data.components.map((comp) => ({
      code: {
        coding: [
          {
            system: LOINC_SYSTEM,
            code: comp.code,
            display: comp.codeDisplay || LOINC_VITALS_DISPLAY[comp.code],
          },
        ],
      },
      valueQuantity: {
        value: comp.value,
        unit: comp.unit,
      },
    }));
  } else if (data.value !== undefined && data.unit) {
    observation.valueQuantity = {
      value: data.value,
      unit: data.unit,
      system: 'http://unitsofmeasure.org',
    };
  }

  return observation;
}
