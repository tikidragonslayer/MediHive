import { AggregatorConfig, AggregatedRecord } from './types';

/**
 * Terra API Bridge — Connects to 200+ wearable and health devices.
 *
 * Terra normalizes data from:
 * - Fitbit, Garmin, Oura, Whoop, Withings, Polar, Suunto
 * - Apple Health, Google Health Connect, Samsung Health
 * - CGMs (Dexcom, Freestyle Libre, etc.)
 * - Smart scales, blood pressure monitors, pulse oximeters
 *
 * Terra provides a unified API so we don't need individual integrations
 * for each device. One API → 200+ devices.
 *
 * API: REST + WebSocket
 * Auth: API key + user tokens
 * Data: activity, body, daily, sleep, nutrition, menstruation
 *
 * This is the primary wearable aggregation layer. Apple HealthKit and
 * Google Health Connect integrations in the mobile SDK are for
 * direct device access; Terra is for web + additional devices.
 */

export class TerraApiBridge {
  private config: AggregatorConfig;
  private baseUrl: string;

  constructor(config: AggregatorConfig) {
    this.config = config;
    this.baseUrl = config.baseUrl ?? 'https://api.tryterra.co/v2';
  }

  /**
   * Generate a widget session for the patient to connect their devices.
   * Terra provides a hosted widget where patients select their devices.
   */
  async generateWidgetSession(
    referenceId: string, // Our patient ID
    providers: string[] = [] // e.g., ['FITBIT', 'GARMIN', 'OURA']
  ): Promise<{ sessionId: string; widgetUrl: string }> {
    const response = await this.apiFetch('/auth/generateWidgetSession', {
      method: 'POST',
      body: JSON.stringify({
        reference_id: referenceId,
        providers: providers.length > 0 ? providers.join(',') : undefined,
        auth_success_redirect_url: `${this.config.baseUrl ?? 'http://localhost:3000'}/health/connected`,
        auth_failure_redirect_url: `${this.config.baseUrl ?? 'http://localhost:3000'}/health/error`,
        language: 'en',
      }),
    });

    return {
      sessionId: (response as { session_id: string })?.session_id ?? '',
      widgetUrl: (response as { url: string })?.url ?? '',
    };
  }

  /**
   * Get all connected users (patients who authorized device access).
   */
  async getConnectedUsers(): Promise<Array<{ userId: string; provider: string; referenceId: string; lastSync: string }>> {
    const response = await this.apiFetch('/subscriptions');
    if (!response?.users) return [];

    return (response.users as Array<{ user_id: string; provider: string; reference_id: string; last_webhook_update: string }>).map((u) => ({
      userId: u.user_id,
      provider: u.provider,
      referenceId: u.reference_id,
      lastSync: u.last_webhook_update,
    }));
  }

  /**
   * Pull activity data (steps, calories, distance, etc.)
   */
  async getActivity(userId: string, startDate: string, endDate?: string): Promise<AggregatedRecord[]> {
    const end = endDate ?? new Date().toISOString().split('T')[0];
    const response = await this.apiFetch(`/activity?user_id=${userId}&start_date=${startDate}&end_date=${end}`);
    return this.normalizeRecords(response, 'activity');
  }

  /**
   * Pull body metrics (weight, body fat, BMI, etc.)
   */
  async getBody(userId: string, startDate: string, endDate?: string): Promise<AggregatedRecord[]> {
    const end = endDate ?? new Date().toISOString().split('T')[0];
    const response = await this.apiFetch(`/body?user_id=${userId}&start_date=${startDate}&end_date=${end}`);
    return this.normalizeRecords(response, 'body');
  }

  /**
   * Pull daily summary (aggregated day metrics).
   */
  async getDaily(userId: string, startDate: string, endDate?: string): Promise<AggregatedRecord[]> {
    const end = endDate ?? new Date().toISOString().split('T')[0];
    const response = await this.apiFetch(`/daily?user_id=${userId}&start_date=${startDate}&end_date=${end}`);
    return this.normalizeRecords(response, 'daily');
  }

  /**
   * Pull sleep data (duration, stages, quality).
   */
  async getSleep(userId: string, startDate: string, endDate?: string): Promise<AggregatedRecord[]> {
    const end = endDate ?? new Date().toISOString().split('T')[0];
    const response = await this.apiFetch(`/sleep?user_id=${userId}&start_date=${startDate}&end_date=${end}`);
    return this.normalizeRecords(response, 'sleep');
  }

  /**
   * Pull nutrition data (calories, macros, hydration).
   */
  async getNutrition(userId: string, startDate: string, endDate?: string): Promise<AggregatedRecord[]> {
    const end = endDate ?? new Date().toISOString().split('T')[0];
    const response = await this.apiFetch(`/nutrition?user_id=${userId}&start_date=${startDate}&end_date=${end}`);
    return this.normalizeRecords(response, 'nutrition');
  }

  /**
   * Pull all data types for a user (full sync).
   */
  async fullSync(userId: string, startDate: string): Promise<AggregatedRecord[]> {
    const [activity, body, daily, sleep, nutrition] = await Promise.all([
      this.getActivity(userId, startDate),
      this.getBody(userId, startDate),
      this.getDaily(userId, startDate),
      this.getSleep(userId, startDate),
      this.getNutrition(userId, startDate),
    ]);

    return [...activity, ...body, ...daily, ...sleep, ...nutrition];
  }

  /**
   * Register webhook for real-time data updates.
   * Terra pushes new data as it arrives from devices.
   */
  async registerWebhook(url: string): Promise<void> {
    // Terra webhooks are configured in the dashboard, not via API
    // This stores the intended webhook URL for documentation
    console.log(`[Terra] Webhook URL configured: ${url}`);
    console.log('[Terra] Configure this URL in Terra dashboard: https://dashboard.tryterra.co/webhooks');
  }

  /**
   * Process incoming Terra webhook payload.
   * Called by your webhook handler when Terra pushes new data.
   */
  processWebhook(payload: {
    type: string; // 'activity', 'body', 'sleep', 'daily', 'nutrition'
    user: { user_id: string; provider: string; reference_id: string };
    data: unknown[];
  }): AggregatedRecord[] {
    return (payload.data ?? []).map((item, i) => ({
      id: `terra-${payload.user.user_id}-${payload.type}-${Date.now()}-${i}`,
      source: `Terra/${payload.user.provider}`,
      resourceType: 'Observation',
      fhirData: this.terraToFHIR(payload.type, item),
      receivedAt: new Date().toISOString(),
      category: 'vitals' as const,
    }));
  }

  // === Private ===

  private async apiFetch(path: string, options?: RequestInit): Promise<Record<string, unknown> | null> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'dev-id': this.config.apiKey,
        'x-api-key': this.config.apiSecret ?? '',
        ...(options?.headers as Record<string, string> ?? {}),
      },
    });

    if (!response.ok) return null;
    return response.json() as Promise<Record<string, unknown>>;
  }

  private normalizeRecords(response: Record<string, unknown> | null, category: string): AggregatedRecord[] {
    if (!response?.data) return [];
    const items = Array.isArray(response.data) ? response.data : [response.data];

    return items.map((item: unknown, i: number) => ({
      id: `terra-${category}-${Date.now()}-${i}`,
      source: 'Terra API',
      resourceType: 'Observation',
      fhirData: this.terraToFHIR(category, item),
      receivedAt: new Date().toISOString(),
      category: 'vitals' as const,
    }));
  }

  /**
   * Convert Terra data format to FHIR Observation.
   */
  private terraToFHIR(dataType: string, data: unknown): object {
    const d = data as Record<string, unknown>;
    const metadata = d.metadata as Record<string, unknown> | undefined;

    return {
      resourceType: 'Observation',
      status: 'final',
      category: [{
        coding: [{
          system: 'http://terminology.hl7.org/CodeSystem/observation-category',
          code: dataType === 'sleep' ? 'sleep' : dataType === 'nutrition' ? 'nutrition' : 'activity',
        }],
      }],
      effectiveDateTime: metadata?.start_time ?? new Date().toISOString(),
      component: this.extractComponents(dataType, d),
      device: { display: `Terra/${(metadata as Record<string, unknown>)?.provider ?? 'unknown'}` },
    };
  }

  private extractComponents(dataType: string, data: Record<string, unknown>): Array<{ code: { text: string }; valueQuantity: { value: number; unit: string } }> {
    const components: Array<{ code: { text: string }; valueQuantity: { value: number; unit: string } }> = [];

    if (dataType === 'activity') {
      if (typeof data.steps === 'number') components.push({ code: { text: 'steps' }, valueQuantity: { value: data.steps, unit: 'count' } });
      if (typeof data.calories === 'number') components.push({ code: { text: 'calories' }, valueQuantity: { value: data.calories, unit: 'kcal' } });
      if (typeof data.distance_meters === 'number') components.push({ code: { text: 'distance' }, valueQuantity: { value: data.distance_meters, unit: 'm' } });
    }

    if (dataType === 'body') {
      if (typeof data.weight_kg === 'number') components.push({ code: { text: 'weight' }, valueQuantity: { value: data.weight_kg, unit: 'kg' } });
      if (typeof data.body_fat_percentage === 'number') components.push({ code: { text: 'body_fat' }, valueQuantity: { value: data.body_fat_percentage, unit: '%' } });
    }

    if (dataType === 'sleep') {
      const sleepData = data.sleep_durations_data as Record<string, Record<string, number>> | undefined;
      if (sleepData?.asleep?.duration_asleep_state_seconds) {
        components.push({ code: { text: 'sleep_duration' }, valueQuantity: { value: sleepData.asleep.duration_asleep_state_seconds / 60, unit: 'min' } });
      }
    }

    return components;
  }
}
