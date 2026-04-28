/**
 * DiagnosticReport serializer: bidirectional conversion between
 * FHIR DiagnosticReport and MediHive DiagnosticReportData.
 */

import type { FHIRDiagnosticReport } from '../../../bridge-core/src/fhir-types';
import type { DiagnosticReportData, MediHiveRecord } from '../types';
import { LOINC_SYSTEM, FHIR_DIAGNOSTIC_CATEGORY_SYSTEM } from '../types';

/**
 * Convert a FHIR DiagnosticReport resource to MediHive DiagnosticReportData.
 */
export function fromFHIR(resource: FHIRDiagnosticReport): DiagnosticReportData {
  const primaryCoding = resource.code.coding?.[0];
  const categoryCoding = resource.category?.[0]?.coding?.[0];

  const presentedForms = (resource.presentedForm ?? []).map((form) => ({
    contentType: form.contentType,
    url: form.url,
    title: form.title,
  }));

  return {
    recordType: 'diagnostic-report',
    status: resource.status,
    category: categoryCoding?.display ?? resource.category?.[0]?.text,
    code: primaryCoding?.code ?? '',
    codeDisplay: primaryCoding?.display ?? resource.code.text ?? '',
    effectiveDate: resource.effectiveDateTime,
    conclusion: resource.conclusion,
    presentedForms,
  };
}

/**
 * Convert MediHive DiagnosticReportData (from a MediHiveRecord) to a FHIR DiagnosticReport.
 */
export function toFHIR(record: MediHiveRecord): FHIRDiagnosticReport {
  const data = record.data as DiagnosticReportData;
  const status = data.status as FHIRDiagnosticReport['status'];

  const category = data.category
    ? [
        {
          coding: [
            {
              system: FHIR_DIAGNOSTIC_CATEGORY_SYSTEM,
              display: data.category,
            },
          ],
          text: data.category,
        },
      ]
    : undefined;

  const presentedForm = data.presentedForms.length > 0
    ? data.presentedForms.map((form) => ({
        contentType: form.contentType,
        url: form.url,
        title: form.title,
      }))
    : undefined;

  return {
    resourceType: 'DiagnosticReport',
    id: record.sourceId || undefined,
    status,
    category,
    code: {
      coding: [
        {
          system: LOINC_SYSTEM,
          code: data.code,
          display: data.codeDisplay,
        },
      ],
      text: data.codeDisplay,
    },
    subject: { reference: `Patient/${record.patientId}` },
    effectiveDateTime: data.effectiveDate,
    conclusion: data.conclusion,
    presentedForm,
  };
}
