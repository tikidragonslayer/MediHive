import { HealthDataPoint, HealthDataSource, HealthSyncResult, ConsentPreferences } from '../types';

/**
 * WearableBridge — Aggregates data from Fitbit, Garmin, Oura, Whoop, Withings.
 *
 * Each wearable has its own API:
 * - Fitbit Web API (REST, OAuth 2.0) — consumer-facing
 * - Garmin Health API (REST, OAuth 1.0a) — enterprise only
 * - Oura API (REST, OAuth 2.0) — consumer
 * - Whoop API (REST, OAuth 2.0) — consumer
 * - Withings API (REST, OAuth 2.0) — consumer
 *
 * On iOS: Most wearables sync to Apple HealthKit automatically.
 * On Android: Most sync to Google Health Connect.
 * Direct API access is needed for:
 * 1. Web-only users (no phone nearby)
 * 2. Advanced metrics not exposed via HealthKit/Health Connect
 * 3. Historical data backfill
 * 4. Enterprise deployments (Garmin Health)
 */

interface WearableConfig {
  source: HealthDataSource;
  clientId: string;
  clientSecret: string;
  accessToken?: string;
  refreshToken?: string;
  apiBaseUrl: string;
}

const WEARABLE_ENDPOINTS: Record<string, { baseUrl: string; authUrl: string; tokenUrl: string }> = {
  fitbit: {
    baseUrl: 'https://api.fitbit.com',
    authUrl: 'https://www.fitbit.com/oauth2/authorize',
    tokenUrl: 'https://api.fitbit.com/oauth2/token',
  },
  oura: {
    baseUrl: 'https://api.ouraring.com/v2',
    authUrl: 'https://cloud.ouraring.com/oauth/authorize',
    tokenUrl: 'https://api.ouraring.com/oauth/token',
  },
  whoop: {
    baseUrl: 'https://api.prod.whoop.com/developer/v1',
    authUrl: 'https://api.prod.whoop.com/oauth/oauth2/auth',
    tokenUrl: 'https://api.prod.whoop.com/oauth/oauth2/token',
  },
  withings: {
    baseUrl: 'https://wbsapi.withings.net',
    authUrl: 'https://account.withings.com/oauth2_user/authorize2',
    tokenUrl: 'https://wbsapi.withings.net/v2/oauth2',
  },
};

export class WearableBridge {
  private configs: Map<HealthDataSource, WearableConfig> = new Map();

  /**
   * Register a wearable data source with OAuth credentials.
   */
  registerSource(config: WearableConfig): void {
    this.configs.set(config.source, config);
  }

  /**
   * Get OAuth authorization URL for a wearable.
   * Redirect user here to authorize data access.
   */
  getAuthUrl(source: HealthDataSource, redirectUri: string, scopes: string[]): string {
    const endpoints = WEARABLE_ENDPOINTS[source];
    const config = this.configs.get(source);
    if (!endpoints || !config) throw new Error(`Source not configured: ${source}`);

    const params = new URLSearchParams({
      client_id: config.clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      scope: scopes.join(' '),
      state: `medihive-${source}-${Date.now()}`,
    });

    return `${endpoints.authUrl}?${params}`;
  }

  /**
   * Exchange authorization code for access token.
   */
  async exchangeCode(source: HealthDataSource, code: string, redirectUri: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number }> {
    const endpoints = WEARABLE_ENDPOINTS[source];
    const config = this.configs.get(source);
    if (!endpoints || !config) throw new Error(`Source not configured: ${source}`);

    const response = await fetch(endpoints.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
      }),
    });

    if (!response.ok) throw new Error(`Token exchange failed: ${response.status}`);
    const data = await response.json() as { access_token: string; refresh_token: string; expires_in: number };

    config.accessToken = data.access_token;
    config.refreshToken = data.refresh_token;

    return { accessToken: data.access_token, refreshToken: data.refresh_token, expiresIn: data.expires_in };
  }

  /**
   * Sync data from a specific wearable source.
   */
  async syncSource(source: HealthDataSource, since: string): Promise<HealthSyncResult> {
    const config = this.configs.get(source);
    if (!config?.accessToken) {
      return { source, dataPointsSynced: 0, newRecordsMinted: 0, errors: ['Not authenticated'], lastSyncTimestamp: new Date().toISOString() };
    }

    try {
      switch (source) {
        case 'fitbit': return await this.syncFitbit(config, since);
        case 'oura': return await this.syncOura(config, since);
        case 'whoop': return await this.syncWhoop(config, since);
        case 'withings': return await this.syncWithings(config, since);
        default: return { source, dataPointsSynced: 0, newRecordsMinted: 0, errors: [`Unsupported source: ${source}`], lastSyncTimestamp: new Date().toISOString() };
      }
    } catch (err) {
      return { source, dataPointsSynced: 0, newRecordsMinted: 0, errors: [err instanceof Error ? err.message : 'unknown'], lastSyncTimestamp: new Date().toISOString() };
    }
  }

  /**
   * Sync all registered and authenticated sources.
   */
  async syncAll(since: string): Promise<HealthSyncResult[]> {
    const results: HealthSyncResult[] = [];
    for (const [source] of this.configs) {
      results.push(await this.syncSource(source, since));
    }
    return results;
  }

  // === Fitbit ===

  private async syncFitbit(config: WearableConfig, since: string): Promise<HealthSyncResult> {
    const date = since.split('T')[0]; // Fitbit uses YYYY-MM-DD
    const dataPoints: HealthDataPoint[] = [];

    // Heart rate
    const hrData = await this.fitbitFetch(config, `/1/user/-/activities/heart/date/${date}/1d/1min.json`) as Record<string, Record<string, unknown>> | null;
    const hrIntraday = hrData?.['activities-heart-intraday'] as { dataset?: Array<{ time: string; value: number }> } | undefined;
    if (hrIntraday?.dataset) {
      for (const point of hrIntraday.dataset) {
        dataPoints.push({
          id: `fitbit-hr-${date}-${point.time}`,
          type: 'heart_rate',
          value: point.value,
          unit: 'bpm',
          timestamp: `${date}T${point.time}`,
          source: 'fitbit',
          deviceName: 'Fitbit',
        });
      }
    }

    // Steps
    const stepsData = await this.fitbitFetch(config, `/1/user/-/activities/steps/date/${date}/1d.json`) as Record<string, Array<{ value: string }>> | null;
    const stepsArr = stepsData?.['activities-steps'];
    if (stepsArr?.[0]) {
      dataPoints.push({
        id: `fitbit-steps-${date}`,
        type: 'steps',
        value: parseInt(stepsArr[0].value),
        unit: 'count',
        timestamp: `${date}T23:59:59`,
        source: 'fitbit',
      });
    }

    // Sleep
    const sleepData = await this.fitbitFetch(config, `/1.2/user/-/sleep/date/${date}.json`) as { sleep?: Array<{ duration: number }> } | null;
    if (sleepData?.sleep?.[0]) {
      const sleep = sleepData.sleep[0];
      dataPoints.push({
        id: `fitbit-sleep-${date}`,
        type: 'sleep_duration',
        value: sleep.duration / 60000, // ms → minutes
        unit: 'min',
        timestamp: `${date}T08:00:00`,
        source: 'fitbit',
      });
    }

    // SpO2
    const spo2Data = await this.fitbitFetch(config, `/1/user/-/spo2/date/${date}.json`);
    if (spo2Data?.value) {
      dataPoints.push({
        id: `fitbit-spo2-${date}`,
        type: 'blood_oxygen',
        value: (spo2Data as { value: number }).value,
        unit: '%',
        timestamp: `${date}T08:00:00`,
        source: 'fitbit',
      });
    }

    return { source: 'fitbit', dataPointsSynced: dataPoints.length, newRecordsMinted: 0, errors: [], lastSyncTimestamp: new Date().toISOString() };
  }

  private async fitbitFetch(config: WearableConfig, path: string): Promise<Record<string, unknown> | null> {
    try {
      const response = await fetch(`${config.apiBaseUrl}${path}`, {
        headers: { Authorization: `Bearer ${config.accessToken}` },
      });
      if (!response.ok) return null;
      return response.json() as Promise<Record<string, unknown>>;
    } catch {
      return null;
    }
  }

  // === Oura ===

  private async syncOura(config: WearableConfig, since: string): Promise<HealthSyncResult> {
    const date = since.split('T')[0];
    const dataPoints: HealthDataPoint[] = [];

    // Heart rate
    const hr = await this.ouraFetch(config, `/usercollection/heartrate?start_date=${date}`);
    if (hr?.data) {
      for (const point of hr.data as Array<{ bpm: number; timestamp: string }>) {
        dataPoints.push({
          id: `oura-hr-${point.timestamp}`,
          type: 'heart_rate',
          value: point.bpm,
          unit: 'bpm',
          timestamp: point.timestamp,
          source: 'oura',
          deviceName: 'Oura Ring',
        });
      }
    }

    // Sleep
    const sleepResp = await this.ouraFetch(config, `/usercollection/sleep?start_date=${date}`) as { data?: Array<{ total_sleep_duration: number; deep_sleep_duration: number; rem_sleep_duration: number }> } | null;
    if (sleepResp?.data?.[0]) {
      const s = sleepResp.data[0];
      dataPoints.push(
        { id: `oura-sleep-${date}`, type: 'sleep_duration', value: s.total_sleep_duration / 60, unit: 'min', timestamp: `${date}T08:00:00`, source: 'oura', deviceName: 'Oura Ring' },
        { id: `oura-deep-${date}`, type: 'sleep_deep', value: s.deep_sleep_duration / 60, unit: 'min', timestamp: `${date}T08:00:00`, source: 'oura' },
        { id: `oura-rem-${date}`, type: 'sleep_rem', value: s.rem_sleep_duration / 60, unit: 'min', timestamp: `${date}T08:00:00`, source: 'oura' },
      );
    }

    return { source: 'oura', dataPointsSynced: dataPoints.length, newRecordsMinted: 0, errors: [], lastSyncTimestamp: new Date().toISOString() };
  }

  private async ouraFetch(config: WearableConfig, path: string): Promise<Record<string, unknown> | null> {
    try {
      const response = await fetch(`${config.apiBaseUrl}${path}`, {
        headers: { Authorization: `Bearer ${config.accessToken}` },
      });
      if (!response.ok) return null;
      return response.json() as Promise<Record<string, unknown>>;
    } catch {
      return null;
    }
  }

  // === Whoop ===

  private async syncWhoop(config: WearableConfig, _since: string): Promise<HealthSyncResult> {
    // Whoop API: /v1/cycle (recovery, strain, sleep)
    return { source: 'whoop', dataPointsSynced: 0, newRecordsMinted: 0, errors: ['Whoop sync implementation pending'], lastSyncTimestamp: new Date().toISOString() };
  }

  // === Withings ===

  private async syncWithings(config: WearableConfig, _since: string): Promise<HealthSyncResult> {
    // Withings API: /measure (weight, BP, SpO2, ECG)
    return { source: 'withings', dataPointsSynced: 0, newRecordsMinted: 0, errors: ['Withings sync implementation pending'], lastSyncTimestamp: new Date().toISOString() };
  }
}
