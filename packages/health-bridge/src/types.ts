/**
 * Health Bridge types — normalized data from aggregator platforms.
 *
 * b.well connects to 1.7M+ healthcare providers via FHIR.
 * Terra API connects to 200+ wearable/health devices.
 *
 * Both normalize health data into FHIR R4 format, which maps directly
 * to MediVault's on-chain record structure.
 */

export interface AggregatorConfig {
  provider: 'bwell' | 'terra';
  apiKey: string;
  apiSecret?: string;
  baseUrl?: string;
  webhookUrl?: string;
}

export interface ConnectedProvider {
  id: string;
  name: string; // e.g., "Cleveland Clinic", "Kaiser Permanente"
  type: 'hospital' | 'clinic' | 'pharmacy' | 'lab' | 'insurance' | 'wearable';
  fhirEndpoint?: string;
  lastSync?: string;
  status: 'connected' | 'expired' | 'error';
}

export interface AggregatedRecord {
  id: string;
  source: string;
  resourceType: string; // FHIR resource type
  fhirData: unknown; // Raw FHIR R4 resource
  receivedAt: string;
  category: 'clinical' | 'vitals' | 'labs' | 'medications' | 'immunizations' | 'insurance';
}

export interface SyncStatus {
  totalProviders: number;
  connectedProviders: number;
  totalRecords: number;
  lastFullSync: string;
  errors: Array<{ provider: string; error: string; timestamp: string }>;
}
