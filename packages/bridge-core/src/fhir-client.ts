import { FHIRBundle, FHIRResource, FHIRPatient, FHIRObservation } from './fhir-types';

/**
 * FHIRClient — Connects to Epic/Cerner/MEDITECH FHIR R4 APIs.
 *
 * For the prototype, this uses the public FHIR sandbox endpoints:
 * - Epic: https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4
 * - SMART Health IT Sandbox: https://launch.smarthealthit.org
 * - HAPI FHIR Public: https://hapi.fhir.org/baseR4
 */
export class FHIRClient {
  private baseUrl: string;
  private accessToken: string | null;

  constructor(config: FHIRClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.accessToken = config.accessToken ?? null;
  }

  /** Fetch a patient by ID */
  async getPatient(patientId: string): Promise<FHIRPatient | null> {
    return this.getResource<FHIRPatient>('Patient', patientId);
  }

  /** Search for patients by name */
  async searchPatients(name: string): Promise<FHIRBundle> {
    return this.search('Patient', { name });
  }

  /** Get all observations (vitals/labs) for a patient */
  async getPatientObservations(
    patientId: string,
    category?: 'vital-signs' | 'laboratory'
  ): Promise<FHIRBundle> {
    const params: Record<string, string> = { patient: patientId };
    if (category) params.category = category;
    return this.search('Observation', params);
  }

  /** Get all conditions (diagnoses) for a patient */
  async getPatientConditions(patientId: string): Promise<FHIRBundle> {
    return this.search('Condition', { patient: patientId });
  }

  /** Get all medications for a patient */
  async getPatientMedications(patientId: string): Promise<FHIRBundle> {
    return this.search('MedicationRequest', { patient: patientId });
  }

  /** Get all allergies for a patient */
  async getPatientAllergies(patientId: string): Promise<FHIRBundle> {
    return this.search('AllergyIntolerance', { patient: patientId });
  }

  /** Get all encounters for a patient */
  async getPatientEncounters(patientId: string): Promise<FHIRBundle> {
    return this.search('Encounter', { patient: patientId });
  }

  /** Get all clinical notes for a patient */
  async getPatientDocuments(patientId: string): Promise<FHIRBundle> {
    return this.search('DocumentReference', { patient: patientId });
  }

  /** Fetch a complete patient record as a FHIR Bundle */
  async getCompletePatientRecord(patientId: string): Promise<FHIRBundle> {
    const [patient, observations, conditions, medications, allergies, encounters] =
      await Promise.all([
        this.getPatient(patientId),
        this.getPatientObservations(patientId),
        this.getPatientConditions(patientId),
        this.getPatientMedications(patientId),
        this.getPatientAllergies(patientId),
        this.getPatientEncounters(patientId),
      ]);

    const entries: Array<{ resource: FHIRResource }> = [];

    if (patient) entries.push({ resource: patient });

    for (const bundle of [observations, conditions, medications, allergies, encounters]) {
      if (bundle.entry) {
        entries.push(...bundle.entry.map((e) => ({ resource: e.resource })));
      }
    }

    return {
      resourceType: 'Bundle',
      type: 'collection',
      total: entries.length,
      entry: entries,
    };
  }

  // === Private helpers ===

  private async getResource<T extends FHIRResource>(
    resourceType: string,
    id: string
  ): Promise<T | null> {
    const url = `${this.baseUrl}/${resourceType}/${id}`;
    const response = await this.fetch(url);
    if (!response.ok) return null;
    return response.json() as Promise<T>;
  }

  private async search(
    resourceType: string,
    params: Record<string, string>
  ): Promise<FHIRBundle> {
    const searchParams = new URLSearchParams(params);
    const url = `${this.baseUrl}/${resourceType}?${searchParams.toString()}`;
    const response = await this.fetch(url);
    if (!response.ok) {
      return { resourceType: 'Bundle', type: 'searchset', total: 0, entry: [] };
    }
    return response.json() as Promise<FHIRBundle>;
  }

  private async fetch(url: string): Promise<Response> {
    const headers: Record<string, string> = {
      Accept: 'application/fhir+json',
    };
    if (this.accessToken) {
      headers.Authorization = `Bearer ${this.accessToken}`;
    }
    return globalThis.fetch(url, { headers });
  }
}

export interface FHIRClientConfig {
  /** FHIR R4 base URL (e.g., https://hapi.fhir.org/baseR4) */
  baseUrl: string;
  /** OAuth2 access token (optional for public sandboxes) */
  accessToken?: string;
}
