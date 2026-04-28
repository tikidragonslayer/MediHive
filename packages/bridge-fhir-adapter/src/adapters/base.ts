/**
 * Abstract EHR adapter interface.
 * All EHR-specific adapters (Epic, Cerner, etc.) implement this contract.
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
import type { EHRConfig, PatientSummary } from '../types';

/**
 * Standard interface that every EHR adapter must implement.
 * Provides CRUD operations for FHIR R4 resources via the EHR's API.
 */
export interface EHRAdapter {
  /** Human-readable adapter name (e.g. 'Epic', 'Cerner') */
  readonly name: string;

  /** Whether the adapter is currently connected and authenticated */
  readonly connected: boolean;

  /** Establish connection to the EHR FHIR endpoint */
  connect(config: EHRConfig): Promise<void>;

  /** Disconnect and clean up resources */
  disconnect(): Promise<void>;

  /** Fetch a single patient by FHIR resource ID */
  getPatient(id: string): Promise<FHIRPatient>;

  /** Search patients by query parameters (e.g. name, birthdate, identifier) */
  searchPatients(query: Record<string, string>): Promise<FHIRPatient[]>;

  /** Fetch observations for a patient, optionally filtered by category */
  getObservations(patientId: string, category?: string): Promise<FHIRObservation[]>;

  /** Fetch active conditions (diagnoses) for a patient */
  getConditions(patientId: string): Promise<FHIRCondition[]>;

  /** Fetch medication requests (orders) for a patient */
  getMedications(patientId: string): Promise<FHIRMedicationRequest[]>;

  /** Fetch allergy/intolerance records for a patient */
  getAllergies(patientId: string): Promise<FHIRAllergyIntolerance[]>;

  /** Fetch encounter history for a patient */
  getEncounters(patientId: string): Promise<FHIREncounter[]>;

  /** Fetch clinical documents for a patient */
  getDocuments(patientId: string): Promise<FHIRDocumentReference[]>;

  /** Fetch diagnostic reports (labs, imaging) for a patient */
  getDiagnosticReports(patientId: string): Promise<FHIRDiagnosticReport[]>;

  /** Write a FHIR resource back to the EHR. Returns the created resource ID. */
  writeResource(resource: FHIRResource): Promise<string>;

  /**
   * Build a full patient summary for MediScribe context injection.
   * Aggregates demographics, vitals, conditions, meds, allergies, encounters, docs, reports.
   */
  getPatientSummary(patientId: string): Promise<PatientSummary>;
}

/**
 * Base class with shared HTTP/OAuth logic that concrete adapters can extend.
 */
export abstract class BaseEHRAdapter implements EHRAdapter {
  abstract readonly name: string;

  protected config: EHRConfig | null = null;
  protected accessToken: string | null = null;
  protected tokenExpiresAt: number = 0;

  get connected(): boolean {
    return this.config !== null && this.accessToken !== null;
  }

  abstract connect(config: EHRConfig): Promise<void>;

  async disconnect(): Promise<void> {
    this.config = null;
    this.accessToken = null;
    this.tokenExpiresAt = 0;
  }

  abstract getPatient(id: string): Promise<FHIRPatient>;
  abstract searchPatients(query: Record<string, string>): Promise<FHIRPatient[]>;
  abstract getObservations(patientId: string, category?: string): Promise<FHIRObservation[]>;
  abstract getConditions(patientId: string): Promise<FHIRCondition[]>;
  abstract getMedications(patientId: string): Promise<FHIRMedicationRequest[]>;
  abstract getAllergies(patientId: string): Promise<FHIRAllergyIntolerance[]>;
  abstract getEncounters(patientId: string): Promise<FHIREncounter[]>;
  abstract getDocuments(patientId: string): Promise<FHIRDocumentReference[]>;
  abstract getDiagnosticReports(patientId: string): Promise<FHIRDiagnosticReport[]>;
  abstract writeResource(resource: FHIRResource): Promise<string>;

  /**
   * Default implementation that aggregates all resource fetches.
   * Concrete adapters can override for optimized bundle queries.
   */
  async getPatientSummary(patientId: string): Promise<PatientSummary> {
    const [
      patientResource,
      observations,
      conditions,
      medications,
      allergies,
      encounters,
      documents,
      reports,
    ] = await Promise.all([
      this.getPatient(patientId),
      this.getObservations(patientId, 'vital-signs'),
      this.getConditions(patientId),
      this.getMedications(patientId),
      this.getAllergies(patientId),
      this.getEncounters(patientId),
      this.getDocuments(patientId),
      this.getDiagnosticReports(patientId),
    ]);

    // Lazily import serializers to avoid circular deps
    const { PatientSerializer, ObservationSerializer, ConditionSerializer, MedicationRequestSerializer, AllergySerializer, EncounterSerializer, DocumentReferenceSerializer, DiagnosticReportSerializer } = await import('../serializers/index');

    return {
      patient: PatientSerializer.fromFHIR(patientResource),
      vitals: observations.map((o) => ObservationSerializer.fromFHIR(o)),
      conditions: conditions.map((c) => ConditionSerializer.fromFHIR(c)),
      medications: medications.map((m) => MedicationRequestSerializer.fromFHIR(m)),
      allergies: allergies.map((a) => AllergySerializer.fromFHIR(a)),
      recentEncounters: encounters.map((e) => EncounterSerializer.fromFHIR(e)),
      recentDocuments: documents.map((d) => DocumentReferenceSerializer.fromFHIR(d)),
      recentReports: reports.map((r) => DiagnosticReportSerializer.fromFHIR(r)),
      lastSyncedAt: new Date().toISOString(),
    };
  }

  /**
   * Ensure we have a valid access token, refreshing if needed.
   */
  protected async ensureAuthenticated(): Promise<string> {
    if (!this.config) {
      throw new Error(`${this.name} adapter is not connected. Call connect() first.`);
    }

    if (this.accessToken && Date.now() < this.tokenExpiresAt) {
      return this.accessToken;
    }

    return this.refreshToken();
  }

  /**
   * Request a new OAuth2 access token using client credentials.
   */
  protected async refreshToken(): Promise<string> {
    if (!this.config) {
      throw new Error(`${this.name} adapter has no configuration.`);
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.config.clientId,
      scope: this.config.scopes.join(' '),
    });

    if (this.config.clientSecret) {
      body.set('client_secret', this.config.clientSecret);
    }

    const response = await fetch(this.config.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `${this.name} OAuth token request failed (${response.status}): ${errorText}`
      );
    }

    const tokenResponse = (await response.json()) as {
      access_token: string;
      expires_in: number;
      token_type: string;
    };

    this.accessToken = tokenResponse.access_token;
    // Refresh 60 seconds before actual expiry
    this.tokenExpiresAt = Date.now() + (tokenResponse.expires_in - 60) * 1000;

    return this.accessToken;
  }

  /**
   * Make an authenticated GET request to the FHIR endpoint.
   */
  protected async fhirGet<T>(path: string, params?: Record<string, string>): Promise<T> {
    const token = await this.ensureAuthenticated();
    const url = new URL(path, this.config!.baseUrl);

    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/fhir+json',
      ...this.config!.additionalHeaders,
    };

    const response = await fetch(url.toString(), { headers });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `${this.name} FHIR GET ${path} failed (${response.status}): ${errorText}`
      );
    }

    return (await response.json()) as T;
  }

  /**
   * Make an authenticated POST request to the FHIR endpoint.
   */
  protected async fhirPost<T>(path: string, body: unknown): Promise<T> {
    const token = await this.ensureAuthenticated();
    const url = new URL(path, this.config!.baseUrl);

    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/fhir+json',
      'Content-Type': 'application/fhir+json',
      ...this.config!.additionalHeaders,
    };

    const response = await fetch(url.toString(), {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `${this.name} FHIR POST ${path} failed (${response.status}): ${errorText}`
      );
    }

    return (await response.json()) as T;
  }

  /**
   * Extract entries from a FHIR Bundle search response.
   */
  protected extractBundleEntries<T>(bundle: {
    entry?: Array<{ resource: T }>;
  }): T[] {
    return (bundle.entry ?? []).map((e) => e.resource);
  }
}
