/**
 * Epic EHR adapter implementing the EHRAdapter interface.
 * Targets Epic's FHIR R4 endpoint with SMART on FHIR OAuth.
 *
 * Epic FHIR R4 sandbox: https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4
 *
 * Epic-specific quirks handled:
 * - Epic uses `urn:oid:` identifiers for MRN (not standard `http://` URIs)
 * - Epic may return extensions prefixed with `http://open.epic.com/FHIR/StructureDefinition/`
 * - Epic paginates with a `link` array in Bundle (rel: 'next')
 * - Epic's Observation search supports `category` and `date` params
 * - Epic requires `Prefer: return=representation` for writes
 */

import type {
  FHIRPatient,
  FHIRObservation,
  FHIRCondition,
  FHIRMedicationRequest,
  FHIRAllergyIntolerance,
  FHIREncounter,
  FHIRDocumentReference,
  FHIRDiagnosticReport,
  FHIRResource,
  FHIRBundle,
} from '../../../bridge-core/src/fhir-types';
import type { EHRConfig } from '../types';
import { BaseEHRAdapter } from './base';

/** Epic sandbox base URL */
const EPIC_SANDBOX_BASE = 'https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4';

/** Bundle-like response with optional pagination link */
interface EpicBundleResponse<T> {
  resourceType: 'Bundle';
  type: string;
  total?: number;
  entry?: Array<{ resource: T }>;
  link?: Array<{ relation: string; url: string }>;
}

export class EpicAdapter extends BaseEHRAdapter {
  readonly name = 'Epic';

  async connect(config: EHRConfig): Promise<void> {
    this.config = {
      ...config,
      baseUrl: config.baseUrl || EPIC_SANDBOX_BASE,
      additionalHeaders: {
        ...config.additionalHeaders,
        // Epic prefers this header for write operations
        Prefer: 'return=representation',
      },
    };

    await this.refreshToken();
  }

  async getPatient(id: string): Promise<FHIRPatient> {
    return this.fhirGet<FHIRPatient>(`Patient/${id}`);
  }

  async searchPatients(query: Record<string, string>): Promise<FHIRPatient[]> {
    // Epic supports: family, given, birthdate, identifier, gender, address, telecom
    const bundle = await this.fhirGet<EpicBundleResponse<FHIRPatient>>('Patient', query);
    return this.extractBundleEntries(bundle);
  }

  async getObservations(patientId: string, category?: string): Promise<FHIRObservation[]> {
    const params: Record<string, string> = {
      patient: patientId,
      _sort: '-date',
      _count: '100',
    };
    if (category) {
      params['category'] = category;
    }

    const bundle = await this.fhirGet<EpicBundleResponse<FHIRObservation>>(
      'Observation',
      params
    );

    return this.extractAllPages(bundle);
  }

  async getConditions(patientId: string): Promise<FHIRCondition[]> {
    const bundle = await this.fhirGet<EpicBundleResponse<FHIRCondition>>('Condition', {
      patient: patientId,
      'clinical-status': 'active,recurrence,relapse',
    });
    return this.extractBundleEntries(bundle);
  }

  async getMedications(patientId: string): Promise<FHIRMedicationRequest[]> {
    const bundle = await this.fhirGet<EpicBundleResponse<FHIRMedicationRequest>>(
      'MedicationRequest',
      {
        patient: patientId,
        status: 'active',
        _sort: '-authoredon',
      }
    );
    return this.extractBundleEntries(bundle);
  }

  async getAllergies(patientId: string): Promise<FHIRAllergyIntolerance[]> {
    const bundle = await this.fhirGet<EpicBundleResponse<FHIRAllergyIntolerance>>(
      'AllergyIntolerance',
      {
        patient: patientId,
        'clinical-status': 'active',
      }
    );
    return this.extractBundleEntries(bundle);
  }

  async getEncounters(patientId: string): Promise<FHIREncounter[]> {
    const bundle = await this.fhirGet<EpicBundleResponse<FHIREncounter>>('Encounter', {
      patient: patientId,
      _sort: '-date',
      _count: '20',
    });
    return this.extractBundleEntries(bundle);
  }

  async getDocuments(patientId: string): Promise<FHIRDocumentReference[]> {
    const bundle = await this.fhirGet<EpicBundleResponse<FHIRDocumentReference>>(
      'DocumentReference',
      {
        patient: patientId,
        _sort: '-date',
        _count: '20',
      }
    );
    return this.extractBundleEntries(bundle);
  }

  async getDiagnosticReports(patientId: string): Promise<FHIRDiagnosticReport[]> {
    const bundle = await this.fhirGet<EpicBundleResponse<FHIRDiagnosticReport>>(
      'DiagnosticReport',
      {
        patient: patientId,
        _sort: '-date',
        _count: '50',
      }
    );
    return this.extractBundleEntries(bundle);
  }

  async writeResource(resource: FHIRResource): Promise<string> {
    const result = await this.fhirPost<{ id: string }>(resource.resourceType, resource);
    return result.id;
  }

  /**
   * Handle Epic's pagination by following 'next' links.
   */
  private async extractAllPages<T>(
    initialBundle: EpicBundleResponse<T>
  ): Promise<T[]> {
    const results = this.extractBundleEntries(initialBundle);
    let nextUrl = this.getNextPageUrl(initialBundle);
    let pageCount = 0;
    const maxPages = 10; // Safety limit

    while (nextUrl && pageCount < maxPages) {
      const token = await this.ensureAuthenticated();
      const response = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/fhir+json',
        },
      });

      if (!response.ok) break;

      const nextBundle = (await response.json()) as EpicBundleResponse<T>;
      results.push(...this.extractBundleEntries(nextBundle));
      nextUrl = this.getNextPageUrl(nextBundle);
      pageCount++;
    }

    return results;
  }

  /**
   * Extract the 'next' pagination URL from an Epic Bundle response.
   */
  private getNextPageUrl(bundle: EpicBundleResponse<unknown>): string | null {
    if (!bundle.link) return null;
    const nextLink = bundle.link.find((l) => l.relation === 'next');
    return nextLink?.url ?? null;
  }
}
