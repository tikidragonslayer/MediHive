/**
 * Patient serializer: bidirectional conversion between FHIR Patient and MediHive PatientData.
 */

import type { FHIRPatient, FHIRIdentifier, FHIRHumanName } from '../../../bridge-core/src/fhir-types';
import type { PatientData, MediHiveRecord } from '../types';
import { FHIR_IDENTIFIER_SYSTEMS } from '../types';

/**
 * Extract MRN from FHIR identifiers.
 */
function extractMrn(identifiers: FHIRIdentifier[] | undefined): string | undefined {
  if (!identifiers) return undefined;

  const mrnIdentifier = identifiers.find(
    (id) =>
      id.system === FHIR_IDENTIFIER_SYSTEMS.MRN ||
      id.type?.coding?.some((c) => c.code === 'MR')
  );
  return mrnIdentifier?.value;
}

/**
 * Build a display name from FHIR HumanName.
 */
function buildDisplayName(names: FHIRHumanName[] | undefined): string {
  if (!names || names.length === 0) return 'Unknown';

  const name = names[0];
  if (name.text) return name.text;

  const given = name.given?.join(' ') ?? '';
  const family = name.family ?? '';
  const prefix = name.prefix?.join(' ') ?? '';
  const suffix = name.suffix?.join(' ') ?? '';

  const parts = [prefix, given, family, suffix].filter(Boolean);
  return parts.join(' ') || 'Unknown';
}

/**
 * Extract phone number from FHIR telecom entries.
 */
function extractPhone(telecom: FHIRPatient['telecom']): string | undefined {
  if (!telecom) return undefined;
  const phone = telecom.find((t) => t.system === 'phone');
  return phone?.value;
}

/**
 * Extract email from FHIR telecom entries.
 */
function extractEmail(telecom: FHIRPatient['telecom']): string | undefined {
  if (!telecom) return undefined;
  const email = telecom.find((t) => t.system === 'email');
  return email?.value;
}

/**
 * Convert a FHIR Patient resource to MediHive PatientData.
 */
export function fromFHIR(resource: FHIRPatient): PatientData {
  const firstName = resource.name?.[0]?.given?.[0] ?? '';
  const lastName = resource.name?.[0]?.family ?? '';
  const displayName = buildDisplayName(resource.name);

  const address = resource.address?.[0];

  return {
    recordType: 'patient',
    mrn: extractMrn(resource.identifier),
    firstName,
    lastName,
    displayName,
    gender: resource.gender,
    birthDate: resource.birthDate,
    address: address
      ? {
          line: address.line,
          city: address.city,
          state: address.state,
          postalCode: address.postalCode,
          country: address.country,
        }
      : undefined,
    phone: extractPhone(resource.telecom),
    email: extractEmail(resource.telecom),
  };
}

/**
 * Convert MediHive PatientData (from a MediHiveRecord) to a FHIR Patient resource.
 */
export function toFHIR(record: MediHiveRecord): FHIRPatient {
  const data = record.data as PatientData;

  const identifiers: FHIRIdentifier[] = [];
  if (data.mrn) {
    identifiers.push({
      system: FHIR_IDENTIFIER_SYSTEMS.MRN,
      value: data.mrn,
      type: {
        coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'MR', display: 'Medical Record Number' }],
      },
    });
  }

  const telecom: FHIRPatient['telecom'] = [];
  if (data.phone) {
    telecom.push({ system: 'phone', value: data.phone, use: 'home' });
  }
  if (data.email) {
    telecom.push({ system: 'email', value: data.email });
  }

  const names: FHIRHumanName[] = [];
  if (data.firstName || data.lastName) {
    names.push({
      family: data.lastName || undefined,
      given: data.firstName ? [data.firstName] : undefined,
      text: data.displayName,
    });
  }

  const gender = data.gender as FHIRPatient['gender'];

  const patient: FHIRPatient = {
    resourceType: 'Patient',
    id: record.sourceId || undefined,
    identifier: identifiers.length > 0 ? identifiers : undefined,
    name: names.length > 0 ? names : undefined,
    gender: gender,
    birthDate: data.birthDate,
    telecom: telecom.length > 0 ? telecom : undefined,
  };

  if (data.address) {
    patient.address = [
      {
        line: data.address.line,
        city: data.address.city,
        state: data.address.state,
        postalCode: data.address.postalCode,
        country: data.address.country,
      },
    ];
  }

  return patient;
}
