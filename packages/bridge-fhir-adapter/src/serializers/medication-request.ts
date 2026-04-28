/**
 * MedicationRequest serializer: bidirectional conversion between
 * FHIR MedicationRequest and MediHive MedicationData.
 */

import type { FHIRMedicationRequest } from '../../../bridge-core/src/fhir-types';
import type { MedicationData, MediHiveRecord } from '../types';
import { RXNORM_SYSTEM } from '../types';

/**
 * Convert a FHIR MedicationRequest to MediHive MedicationData.
 */
export function fromFHIR(resource: FHIRMedicationRequest): MedicationData {
  const medConcept = resource.medicationCodeableConcept;
  const primaryCoding = medConcept?.coding?.[0];

  const dosageInstructions = resource.dosageInstruction?.map((dosage) => {
    const timing = dosage.timing?.repeat;
    const dose = dosage.doseAndRate?.[0]?.doseQuantity;

    return {
      text: dosage.text,
      frequency: timing?.frequency,
      period: timing?.period,
      periodUnit: timing?.periodUnit,
      doseValue: dose?.value,
      doseUnit: dose?.unit,
    };
  });

  return {
    recordType: 'medication',
    medicationCode: primaryCoding?.code,
    medicationSystem: primaryCoding?.system,
    medicationDisplay: primaryCoding?.display ?? medConcept?.text ?? 'Unknown medication',
    status: resource.status,
    authoredOn: resource.authoredOn,
    dosageInstructions,
  };
}

/**
 * Convert MediHive MedicationData (from a MediHiveRecord) to a FHIR MedicationRequest.
 */
export function toFHIR(record: MediHiveRecord): FHIRMedicationRequest {
  const data = record.data as MedicationData;
  const status = data.status as FHIRMedicationRequest['status'];

  const dosageInstruction: FHIRMedicationRequest['dosageInstruction'] = data.dosageInstructions?.map(
    (instruction) => {
      const dosage: NonNullable<FHIRMedicationRequest['dosageInstruction']>[number] = {};

      if (instruction.text) {
        dosage.text = instruction.text;
      }

      if (instruction.frequency || instruction.period || instruction.periodUnit) {
        dosage.timing = {
          repeat: {
            frequency: instruction.frequency,
            period: instruction.period,
            periodUnit: instruction.periodUnit,
          },
        };
      }

      if (instruction.doseValue !== undefined && instruction.doseUnit) {
        dosage.doseAndRate = [
          {
            doseQuantity: {
              value: instruction.doseValue,
              unit: instruction.doseUnit,
            },
          },
        ];
      }

      return dosage;
    }
  );

  return {
    resourceType: 'MedicationRequest',
    id: record.sourceId || undefined,
    status,
    medicationCodeableConcept: {
      coding: [
        {
          system: data.medicationSystem ?? RXNORM_SYSTEM,
          code: data.medicationCode ?? undefined,
          display: data.medicationDisplay,
        },
      ],
      text: data.medicationDisplay,
    },
    subject: { reference: `Patient/${record.patientId}` },
    authoredOn: data.authoredOn,
    dosageInstruction,
  };
}
