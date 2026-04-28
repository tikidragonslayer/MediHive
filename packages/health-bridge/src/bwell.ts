import { AggregatorConfig, ConnectedProvider, AggregatedRecord, SyncStatus } from './types';

/**
 * b.well Bridge — Connects to 1.7M+ healthcare providers.
 *
 * b.well is the health data aggregator used by:
 * - Perplexity Health (launched March 2026)
 * - ChatGPT Health (launched January 2026)
 * - Major health systems for patient data exchange
 *
 * How it works:
 * 1. Patient authorizes b.well to access their provider accounts
 * 2. b.well pulls records from each provider via FHIR
 * 3. Medi-Hive reads from b.well's API
 * 4. Records are encrypted and stored on blockchain
 *
 * b.well API: REST + FHIR R4
 * Auth: OAuth 2.0 (patient-delegated)
 * Data: Allergies, conditions, encounters, immunizations, labs, medications, procedures, vitals
 *
 * Integration with Perplexity Health:
 * - Patient's Perplexity Health data flows through b.well
 * - Medi-Hive connects to the same b.well account
 * - Records are automatically available in both systems
 * - Blockchain adds ownership, encryption, and audit trail that Perplexity doesn't have
 */

export class BwellBridge {
  private config: AggregatorConfig;
  private accessToken: string | null = null;
  private baseUrl: string;

  constructor(config: AggregatorConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl ?? 'https://api.b.well-connected.com/v1';
  }

  /**
   * Get OAuth authorization URL for patient to connect their b.well account.
   * This is the same account they use with Perplexity Health / ChatGPT Health.
   */
  getAuthUrl(redirectUri: string, scopes: string[] = ['patient/*.read']): string {
    const params = new URLSearchParams({
      client_id: this.config.apiKey,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: scopes.join(' '),
      state: `medihive-bwell-${Date.now()}`,
    });
    return `${this.baseUrl}/oauth/authorize?${params}`;
  }

  /**
   * Exchange authorization code for access token.
   */
  async authenticate(code: string, redirectUri: string): Promise<{ accessToken: string; expiresIn: number }> {
    const response = await fetch(`${this.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: this.config.apiKey,
        client_secret: this.config.apiSecret ?? '',
      }),
    });

    if (!response.ok) throw new Error(`b.well auth failed: ${response.status}`);
    const data = await response.json() as { access_token: string; expires_in: number };
    this.accessToken = data.access_token;
    return { accessToken: data.access_token, expiresIn: data.expires_in };
  }

  /**
   * List all healthcare providers connected to the patient's b.well account.
   */
  async getConnectedProviders(): Promise<ConnectedProvider[]> {
    const data = await this.apiFetch('/connections');
    if (!data?.connections) return [];

    return (data.connections as Array<{ id: string; name: string; type: string; fhir_endpoint: string; last_sync: string; status: string }>).map((c) => ({
      id: c.id,
      name: c.name,
      type: (c.type ?? 'hospital') as ConnectedProvider['type'],
      fhirEndpoint: c.fhir_endpoint,
      lastSync: c.last_sync,
      status: (c.status ?? 'connected') as ConnectedProvider['status'],
    }));
  }

  /**
   * Pull all FHIR records from b.well for the authenticated patient.
   * Returns normalized records ready for blockchain storage.
   */
  async pullAllRecords(): Promise<AggregatedRecord[]> {
    const resourceTypes = [
      'AllergyIntolerance',
      'Condition',
      'DiagnosticReport',
      'Encounter',
      'Immunization',
      'MedicationRequest',
      'Observation',
      'Procedure',
    ];

    const allRecords: AggregatedRecord[] = [];

    for (const resourceType of resourceTypes) {
      try {
        const bundle = await this.apiFetch(`/fhir/r4/${resourceType}`);
        if (bundle?.entry) {
          for (const entry of bundle.entry as Array<{ resource: { resourceType: string; id: string; meta?: { source?: string } } }>) {
            allRecords.push({
              id: `bwell-${entry.resource.id}`,
              source: entry.resource.meta?.source ?? 'b.well',
              resourceType: entry.resource.resourceType,
              fhirData: entry.resource,
              receivedAt: new Date().toISOString(),
              category: this.categorize(entry.resource.resourceType),
            });
          }
        }
      } catch (err) {
        console.error(`[b.well] Failed to fetch ${resourceType}:`, err);
      }
    }

    return allRecords;
  }

  /**
   * Pull records from a specific provider (e.g., "Cleveland Clinic" only).
   */
  async pullProviderRecords(providerId: string): Promise<AggregatedRecord[]> {
    const data = await this.apiFetch(`/connections/${providerId}/records`);
    if (!data?.records) return [];

    return (data.records as Array<{ id: string; resource_type: string; fhir: unknown; source: string }>).map((r) => ({
      id: `bwell-${providerId}-${r.id}`,
      source: r.source,
      resourceType: r.resource_type,
      fhirData: r.fhir,
      receivedAt: new Date().toISOString(),
      category: this.categorize(r.resource_type),
    }));
  }

  /**
   * Register a webhook for real-time record updates.
   * When new data arrives at b.well (e.g., new lab result), we get notified.
   */
  async registerWebhook(webhookUrl: string, events: string[] = ['record.created', 'record.updated']): Promise<{ webhookId: string }> {
    const data = await this.apiFetch('/webhooks', {
      method: 'POST',
      body: JSON.stringify({ url: webhookUrl, events }),
    });
    return { webhookId: (data as { id: string })?.id ?? `wh-${Date.now()}` };
  }

  /**
   * Get sync status across all connected providers.
   */
  async getSyncStatus(): Promise<SyncStatus> {
    const providers = await this.getConnectedProviders();
    const connected = providers.filter((p) => p.status === 'connected');
    const errors = providers
      .filter((p) => p.status === 'error')
      .map((p) => ({ provider: p.name, error: 'Connection error', timestamp: new Date().toISOString() }));

    return {
      totalProviders: providers.length,
      connectedProviders: connected.length,
      totalRecords: 0, // Would come from /stats endpoint
      lastFullSync: connected[0]?.lastSync ?? '',
      errors,
    };
  }

  // === Private ===

  private async apiFetch(path: string, options?: RequestInit): Promise<Record<string, unknown> | null> {
    if (!this.accessToken && !this.config.apiKey) {
      throw new Error('b.well not authenticated — call authenticate() first');
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.accessToken ?? this.config.apiKey}`,
        ...(options?.headers as Record<string, string> ?? {}),
      },
    });

    if (!response.ok) {
      if (response.status === 401) throw new Error('b.well auth expired — re-authenticate');
      return null;
    }

    return response.json() as Promise<Record<string, unknown>>;
  }

  private categorize(resourceType: string): AggregatedRecord['category'] {
    const map: Record<string, AggregatedRecord['category']> = {
      AllergyIntolerance: 'clinical',
      Condition: 'clinical',
      DiagnosticReport: 'labs',
      Encounter: 'clinical',
      Immunization: 'immunizations',
      MedicationRequest: 'medications',
      Observation: 'vitals',
      Procedure: 'clinical',
      Coverage: 'insurance',
    };
    return map[resourceType] ?? 'clinical';
  }
}
