/**
 * DocumentReference serializer: bidirectional conversion between
 * FHIR DocumentReference and MediHive DocumentData.
 */

import type { FHIRDocumentReference } from '../../../bridge-core/src/fhir-types';
import type { DocumentData, MediHiveRecord } from '../types';
import { LOINC_SYSTEM } from '../types';

/**
 * Convert a FHIR DocumentReference resource to MediHive DocumentData.
 */
export function fromFHIR(resource: FHIRDocumentReference): DocumentData {
  const primaryContent = resource.content[0]?.attachment;
  const typeCoding = resource.type?.coding?.[0];

  const authors = (resource.author ?? []).map(
    (a) => a.display ?? a.reference ?? 'Unknown'
  );

  return {
    recordType: 'document',
    status: resource.status,
    docType: typeCoding?.display ?? resource.type?.text,
    docTypeCode: typeCoding?.code,
    date: resource.date,
    authors,
    contentType: primaryContent?.contentType,
    contentBase64: primaryContent?.data,
    contentUrl: primaryContent?.url,
    title: primaryContent?.title,
  };
}

/**
 * Convert MediHive DocumentData (from a MediHiveRecord) to a FHIR DocumentReference resource.
 */
export function toFHIR(record: MediHiveRecord): FHIRDocumentReference {
  const data = record.data as DocumentData;
  const status = data.status as FHIRDocumentReference['status'];

  const author = data.authors.length > 0
    ? data.authors.map((a) => ({ display: a }))
    : undefined;

  return {
    resourceType: 'DocumentReference',
    id: record.sourceId || undefined,
    status,
    type: data.docTypeCode
      ? {
          coding: [
            {
              system: LOINC_SYSTEM,
              code: data.docTypeCode,
              display: data.docType,
            },
          ],
          text: data.docType,
        }
      : data.docType
        ? { text: data.docType }
        : undefined,
    subject: { reference: `Patient/${record.patientId}` },
    date: data.date,
    author,
    content: [
      {
        attachment: {
          contentType: data.contentType,
          data: data.contentBase64,
          url: data.contentUrl,
          title: data.title,
        },
      },
    ],
  };
}
