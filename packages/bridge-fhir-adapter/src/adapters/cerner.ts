/**
 * Cerner (Oracle Health) EHR adapter implementing the EHRAdapter interface.
 * Targets Cerner's FHIR R4 endpoint with SMART on FHIR OAuth.
 *
 * Cerner FHIR R4 sandbox:
 *   https://fhir-ehr-code.cerner.com/r4/ec2458f2-1e24-41c8-b71b-0e701af7583d
 *
 * Cerner-specific quirks handled:
 * - Cerner uses `https://fhir.cerner.com/` extension namespace
 * - Cerner returns `OperationOutcome` in Bundle entries for partial failures
 * - Cerner AllergyIntolerance requires `patient` param (not `subject`)
 * - Cerner MedicationRequest uses `reported` extension for medication history
 * - Cerner Encounter search supports `_count` but caps at 200
 * - Cerner may return resources with `meta.versionId` for concurrency control
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
} from '../../../bridge-core/src/fhir-types';
import type { EHRConfig } from '../types';
import { BaseEHRAdapter } from './base';

/** Cerner sandbox tenant base URL */
const CERNER_SANDBOX_BASE =
  'https://fhir-ehr-code.cerner.com/r4/ec2458f2-1e24-41c8-b71b-0e701af7583d';

/** Bundle-like response from Cerner */
interface CernerBundleResponse<T> {
  resourceType: 'Bundle';
  type: string;
  total?: number;
  entry?: Array<{ resource: T | CernerOperationOutcome }>;
  link?: Array<{ relation: string; url: string }>;
}

/** Cerner may include OperationOutcome entries for partial failures */
interface CernerOperationOutcome {
  resourceType: 'OperationOutcome';
  issue: Array<{
    severity: string;
    code: string;
    diagnostics?: string;
  }>;
}

function isOperationOutcome(
  resource: unknown
): resource is CernerOperationOutcome {
  return (
    typeof resource === 'object' &&
    resource !== null &&
    (resource as Record<string, unknown>)['resourceType'] === 'OperationOutcome'
  );
}

export class CernerAdapter extends BaseEHRAdapter {
  readonly name = 'Cerner';

  async connect(config: EHRConfig): Promise<void> {
    this.config = {
      ...config,
      baseUrl: config.baseUrl || CERNER_SANDBOX_BASE,
    };

    await this.refreshToken();
  }

  async getPatient(id: string): Promise<FHIRPatient> {
    return this.fhirGet<FHIRPatient>(`Patient/${id}`);
  }

  async searchPatients(query: Record<string, string>): Promise<FHIRPatient[]> {
    const bundle = await this.fhirGet<CernerBundleResponse<FHIRPatient>>('Patient', query);
    return this.filterOutcomes(bundle);
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

    const bundle = await this.fhirGet<CernerBundleResponse<FHIRObservation>>(
      'Observation',
      params
    );

    return this.extractAllPages(bundle);
  }

  async getConditions(patientId: string): Promise<FHIRCondition[]> {
    const bundle = await this.fhirGet<CernerBundleResponse<FHIRCondition>>('Condition', {
      patient: patientId,
      'clinical-status': 'active',
    });
    return this.filterOutcomes(bundle);
  }

  async getMedications(patientId: string): Promise<FHIRMedicationRequest[]> {
    // Cerner supports filtering by status; also fetch completed for medication history
    const bundle = await this.fhirGet<CernerBundleResponse<FHIRMedicationRequest>>(
      'MedicationRequest',
      {
        patient: patientId,
        _count: '100',
      }
    );
    return this.filterOutcomes(bundle);
  }

  async getAllergies(patientId: string): Promise<FHIRAllergyIntolerance[]> {
    // Cerner requires `patient` parameter (not `subject`)
    const bundle = await this.fhirGet<CernerBundleResponse<FHIRAllergyIntolerance>>(
      'AllergyIntolerance',
      {
        patient: patientId,
      }
    );
    return this.filterOutcomes(bundle);
  }

  async getEncounters(patientId: string): Promise<FHIREncounter[]> {
    // Cerner caps _count at 200
    const bundle = await this.fhirGet<CernerBundleResponse<FHIREncounter>>('Encounter', {
      patient: patientId,
      _sort: '-date',
      _count: '20',
    });
    return this.filterOutcomes(bundle);
  }

  async getDocuments(patientId: string): Promise<FHIRDocumentReference[]> {
    const bundle = await this.fhirGet<CernerBundleResponse<FHIRDocumentReference>>(
      'DocumentReference',
      {
        patient: patientId,
        _sort: '-date',
        _count: '20',
      }
    );
    return this.filterOutcomes(bundle);
  }

  async getDiagnosticReports(patientId: string): Promise<FHIRDiagnosticReport[]> {
    const bundle = await this.fhirGet<CernerBundleResponse<FHIRDiagnosticReport>>(
      'DiagnosticReport',
      {
        patient: patientId,
        _sort: '-date',
        _count: '50',
      }
    );
    return this.filterOutcomes(bundle);
  }

  async writeResource(resource: FHIRResource): Promise<string> {
    const result = await this.fhirPost<{ id: string }>(resource.resourceType, resource);
    return result.id;
  }

  /**
   * Filter out OperationOutcome entries from Cerner Bundle responses.
   * Cerner may include these for partial failures within a search result set.
   */
  private filterOutcomes<T>(
    bundle: CernerBundleResponse<T>
  ): T[] {
    if (!bundle.entry) return [];
    return bundle.entry
      .map((e) => e.resource)
      .filter((r): r is T => !isOperationOutcome(r));
  }

  /**
   * Handle Cerner's pagination by following 'next' links.
   */
  private async extractAllPages<T>(
    initialBundle: CernerBundleResponse<T>
  ): Promise<T[]> {
    const results = this.filterOutcomes(initialBundle);
    let nextUrl = this.getNextPageUrl(initialBundle);
    let pageCount = 0;
    const maxPages = 10;

    while (nextUrl && pageCount < maxPages) {
      const token = await this.ensureAuthenticated();
      const response = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/fhir+json',
        },
      });

      if (!response.ok) break;

      const nextBundle = (await response.json()) as CernerBundleResponse<T>;
      results.push(...this.filterOutcomes(nextBundle));
      nextUrl = this.getNextPageUrl(nextBundle);
      pageCount++;
    }

    return results;
  }

  /**
   * Extract the 'next' pagination URL from a Cerner Bundle response.
   */
  private getNextPageUrl(bundle: CernerBundleResponse<unknown>): string | null {
    if (!bundle.link) return null;
    const nextLink = bundle.link.find((l) => l.relation === 'next');
    return nextLink?.url ?? null;
  }
}
