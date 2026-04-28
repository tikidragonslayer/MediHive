import { BwellBridge } from './bwell';
import { TerraApiBridge } from './terra';
import { AggregatorConfig, AggregatedRecord, ConnectedProvider, SyncStatus } from './types';

/**
 * HealthAggregator — Unified interface for all health data sources.
 *
 * Combines:
 * - b.well (1.7M+ providers, FHIR clinical records) — used by Perplexity Health & ChatGPT Health
 * - Terra API (200+ wearable devices) — Fitbit, Garmin, Oura, Whoop, etc.
 *
 * The aggregator deduplicates records across sources and normalizes everything
 * into FHIR R4 format for blockchain storage.
 *
 * Data flow:
 * b.well (hospitals) ──┐
 *                       ├──► HealthAggregator ──► Encrypt ──► IPFS ──► Solana
 * Terra (wearables) ────┘
 */

export class HealthAggregator {
  private bwell?: BwellBridge;
  private terra?: TerraApiBridge;

  /** Initialize b.well connection */
  connectBwell(config: AggregatorConfig): void {
    this.bwell = new BwellBridge(config);
  }

  /** Initialize Terra API connection */
  connectTerra(config: AggregatorConfig): void {
    this.terra = new TerraApiBridge(config);
  }

  /** Get patient authorization URLs for all configured aggregators */
  getAuthUrls(redirectUri: string): Array<{ provider: string; url: string }> {
    const urls: Array<{ provider: string; url: string }> = [];

    if (this.bwell) {
      urls.push({ provider: 'b.well (Hospital Records)', url: this.bwell.getAuthUrl(redirectUri) });
    }

    // Terra uses a widget, not a direct OAuth URL
    // The widget URL is generated server-side via generateWidgetSession

    return urls;
  }

  /** Pull all records from all connected sources */
  async pullAllRecords(): Promise<{
    records: AggregatedRecord[];
    bySource: Record<string, number>;
    byCategory: Record<string, number>;
    duplicatesRemoved: number;
  }> {
    const allRecords: AggregatedRecord[] = [];

    // b.well (clinical records from hospitals)
    if (this.bwell) {
      try {
        const bwellRecords = await this.bwell.pullAllRecords();
        allRecords.push(...bwellRecords);
      } catch (err) {
        console.error('[Aggregator] b.well pull failed:', err);
      }
    }

    // Terra (wearable data) — would need user IDs from connected users list
    // In production: iterate over all connected Terra users
    if (this.terra) {
      try {
        const users = await this.terra.getConnectedUsers();
        const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split('T')[0];

        for (const user of users) {
          const records = await this.terra.fullSync(user.userId, yesterday);
          allRecords.push(...records);
        }
      } catch (err) {
        console.error('[Aggregator] Terra pull failed:', err);
      }
    }

    // Deduplicate (same resource type + same date + same source = duplicate)
    const seen = new Set<string>();
    const deduped: AggregatedRecord[] = [];
    let duplicatesRemoved = 0;

    for (const record of allRecords) {
      const key = `${record.resourceType}:${record.source}:${record.receivedAt.split('T')[0]}:${JSON.stringify(record.fhirData).substring(0, 100)}`;
      if (seen.has(key)) {
        duplicatesRemoved++;
        continue;
      }
      seen.add(key);
      deduped.push(record);
    }

    // Categorize
    const bySource: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    for (const r of deduped) {
      bySource[r.source] = (bySource[r.source] ?? 0) + 1;
      byCategory[r.category] = (byCategory[r.category] ?? 0) + 1;
    }

    return { records: deduped, bySource, byCategory, duplicatesRemoved };
  }

  /** Get connected providers across all aggregators */
  async getConnectedProviders(): Promise<ConnectedProvider[]> {
    const providers: ConnectedProvider[] = [];

    if (this.bwell) {
      const bwellProviders = await this.bwell.getConnectedProviders();
      providers.push(...bwellProviders);
    }

    if (this.terra) {
      const terraUsers = await this.terra.getConnectedUsers();
      providers.push(...terraUsers.map((u) => ({
        id: u.userId,
        name: u.provider,
        type: 'wearable' as const,
        lastSync: u.lastSync,
        status: 'connected' as const,
      })));
    }

    return providers;
  }

  /** Get overall sync status */
  async getSyncStatus(): Promise<SyncStatus> {
    const providers = await this.getConnectedProviders();
    return {
      totalProviders: providers.length,
      connectedProviders: providers.filter((p) => p.status === 'connected').length,
      totalRecords: 0,
      lastFullSync: providers.reduce((latest, p) => (p.lastSync && p.lastSync > latest) ? p.lastSync : latest, ''),
      errors: providers.filter((p) => p.status === 'error').map((p) => ({ provider: p.name, error: 'Connection error', timestamp: new Date().toISOString() })),
    };
  }
}
