import { createHash } from 'crypto';
import {
  FHIRBundle,
  FHIRPatient,
  FHIRObservation,
  FHIRCondition,
  FHIRMedicationRequest,
  FHIRAllergyIntolerance,
  FHIRDocumentReference,
} from './fhir-types';

/**
 * FHIRTransformer — Converts FHIR R4 bundles to MediVault schema.
 *
 * Maps FHIR resources to the on-chain record types:
 * - Patient → Patient Passport identity hash
 * - Observation → Record NFT (type: Lab or Vital)
 * - Condition → Record NFT (type: Note) with ICD codes
 * - MedicationRequest → Record NFT (type: Prescription)
 * - DocumentReference → Record NFT (type: Note)
 * - AllergyIntolerance → included in patient summary
 */
export class FHIRTransformer {
  /** Extract a patient summary from a FHIR bundle for MediBrain context */
  static extractPatientSummary(bundle: FHIRBundle): PatientSummary {
    const patient = bundle.entry?.find(
      (e) => e.resource.resourceType === 'Patient'
    )?.resource as FHIRPatient | undefined;

    const observations = (bundle.entry ?? [])
      .filter((e) => e.resource.resourceType === 'Observation')
      .map((e) => e.resource as FHIRObservation);

    const conditions = (bundle.entry ?? [])
      .filter((e) => e.resource.resourceType === 'Condition')
      .map((e) => e.resource as FHIRCondition);

    const medications = (bundle.entry ?? [])
      .filter((e) => e.resource.resourceType === 'MedicationRequest')
      .map((e) => e.resource as FHIRMedicationRequest);

    const allergies = (bundle.entry ?? [])
      .filter((e) => e.resource.resourceType === 'AllergyIntolerance')
      .map((e) => e.resource as FHIRAllergyIntolerance);

    const vitals = observations.filter((o) =>
      o.category?.some((c) =>
        c.coding?.some((cd) => cd.code === 'vital-signs')
      )
    );

    const labs = observations.filter((o) =>
      o.category?.some((c) =>
        c.coding?.some((cd) => cd.code === 'laboratory')
      )
    );

    return {
      demographics: patient
        ? {
            name: patient.name?.[0]?.text ??
              `${patient.name?.[0]?.given?.join(' ') ?? ''} ${patient.name?.[0]?.family ?? ''}`.trim(),
            gender: patient.gender ?? 'unknown',
            birthDate: patient.birthDate ?? '',
            mrn: patient.identifier?.find(
              (i) => i.type?.coding?.some((c) => c.code === 'MR')
            )?.value ?? '',
          }
        : undefined,
      activeConditions: conditions
        .filter((c) =>
          c.clinicalStatus?.coding?.some((cd) => cd.code === 'active')
        )
        .map((c) => ({
          code: c.code?.coding?.[0]?.code ?? '',
          display: c.code?.text ?? c.code?.coding?.[0]?.display ?? '',
          onset: c.onsetDateTime ?? '',
        })),
      currentMedications: medications
        .filter((m) => m.status === 'active')
        .map((m) => ({
          name: m.medicationCodeableConcept?.text ??
            m.medicationCodeableConcept?.coding?.[0]?.display ?? '',
          dosage: m.dosageInstruction?.[0]?.text ?? '',
        })),
      allergies: allergies.map((a) => ({
        substance: a.code?.text ?? a.code?.coding?.[0]?.display ?? '',
        severity: a.reaction?.[0]?.severity ?? 'unknown',
      })),
      latestVitals: this.extractLatestVitals(vitals),
      recentLabs: labs.slice(0, 10).map((l) => ({
        name: l.code?.text ?? l.code?.coding?.[0]?.display ?? '',
        value: l.valueQuantity
          ? `${l.valueQuantity.value} ${l.valueQuantity.unit}`
          : l.valueString ?? '',
        date: l.effectiveDateTime ?? '',
      })),
    };
  }

  /** Convert a FHIR bundle to encrypted payload ready for IPFS */
  static bundleToJSON(bundle: FHIRBundle): string {
    return JSON.stringify(bundle);
  }

  /** Hash a FHIR bundle for on-chain content verification */
  static hashBundle(bundle: FHIRBundle): Uint8Array {
    const json = this.bundleToJSON(bundle);
    return new Uint8Array(createHash('sha256').update(json).digest());
  }

  /** Extract ICD-10 codes from conditions for on-chain storage */
  static extractICDCodes(bundle: FHIRBundle): string[] {
    return (bundle.entry ?? [])
      .filter((e) => e.resource.resourceType === 'Condition')
      .flatMap((e) => {
        const condition = e.resource as FHIRCondition;
        return (
          condition.code?.coding
            ?.filter((c) => c.system?.includes('icd'))
            .map((c) => c.code ?? '') ?? []
        );
      })
      .filter(Boolean);
  }

  /** Hash ICD codes for on-chain storage (privacy-preserving) */
  static hashICDCodes(codes: string[]): Uint8Array {
    const sorted = [...codes].sort().join(',');
    return new Uint8Array(createHash('sha256').update(sorted).digest());
  }

  /** Map FHIR resource type to MediVault RecordType enum */
  static mapResourceToRecordType(resourceType: string): number {
    const mapping: Record<string, number> = {
      DocumentReference: 0, // Note
      Observation: 1,       // Lab (or Vital based on category)
      DiagnosticReport: 2,  // Imaging
      MedicationRequest: 3, // Prescription
      Encounter: 5,         // Procedure
    };
    return mapping[resourceType] ?? 0;
  }

  private static extractLatestVitals(
    observations: FHIRObservation[]
  ): Record<string, { value: string; date: string }> {
    const vitals: Record<string, { value: string; date: string }> = {};
    const vitalCodes: Record<string, string> = {
      '8867-4': 'heartRate',
      '8310-5': 'temperature',
      '8462-4': 'diastolicBP',
      '8480-6': 'systolicBP',
      '8302-2': 'height',
      '29463-7': 'weight',
      '2708-6': 'spO2',
      '9279-1': 'respiratoryRate',
    };

    for (const obs of observations) {
      const loincCode = obs.code?.coding?.find(
        (c) => c.system === 'http://loinc.org'
      )?.code;

      if (loincCode && vitalCodes[loincCode]) {
        const key = vitalCodes[loincCode];
        const existing = vitals[key];
        const obsDate = obs.effectiveDateTime ?? '';

        if (!existing || obsDate > existing.date) {
          if (obs.component && (key === 'systolicBP' || key === 'diastolicBP')) {
            // Blood pressure has components
            for (const comp of obs.component) {
              const compCode = comp.code?.coding?.find(
                (c) => c.system === 'http://loinc.org'
              )?.code;
              if (compCode === '8480-6') {
                vitals.systolicBP = {
                  value: `${comp.valueQuantity?.value ?? ''} ${comp.valueQuantity?.unit ?? 'mmHg'}`,
                  date: obsDate,
                };
              } else if (compCode === '8462-4') {
                vitals.diastolicBP = {
                  value: `${comp.valueQuantity?.value ?? ''} ${comp.valueQuantity?.unit ?? 'mmHg'}`,
                  date: obsDate,
                };
              }
            }
          } else {
            vitals[key] = {
              value: obs.valueQuantity
                ? `${obs.valueQuantity.value} ${obs.valueQuantity.unit}`
                : obs.valueString ?? '',
              date: obsDate,
            };
          }
        }
      }
    }

    return vitals;
  }
}

// === Summary Types ===

export interface PatientSummary {
  demographics?: {
    name: string;
    gender: string;
    birthDate: string;
    mrn: string;
  };
  activeConditions: Array<{ code: string; display: string; onset: string }>;
  currentMedications: Array<{ name: string; dosage: string }>;
  allergies: Array<{ substance: string; severity: string }>;
  latestVitals: Record<string, { value: string; date: string }>;
  recentLabs: Array<{ name: string; value: string; date: string }>;
}
