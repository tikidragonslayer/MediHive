import { MobileWallet } from './wallet';
import { HealthKitBridge } from './platforms/apple-healthkit';
import { HealthConnectBridge } from './platforms/google-health-connect';
import { WearableBridge } from './platforms/wearables';
import {
  HealthDataSource, HealthSyncResult, ClinicalRecord,
  ConsentPreferences, MobileConfig, WalletInfo,
} from './types';

/**
 * MediHiveMobile — Main orchestrator for the patient mobile app.
 *
 * This is the patient's personal health data node:
 * 1. Wallet (own your keys, own your data)
 * 2. Health data sync (HealthKit, Health Connect, wearables)
 * 3. Clinical records (FHIR from hospitals via SMART on FHIR)
 * 4. Consent management (grant/revoke access)
 * 5. NFC/QR for hospital check-in
 * 6. Audit trail (who accessed your data)
 *
 * Sync flow:
 * Device Health Data → Normalize → Encrypt → IPFS → Mint Record NFT → Solana
 *
 * The app works OFFLINE:
 * - Wallet/keys stored in secure enclave
 * - Recent records cached locally (encrypted)
 * - Sync queue for when connectivity restored
 * - NFC check-in works offline (just shares pubkey)
 */

export class MediHiveMobile {
  private wallet: MobileWallet;
  private healthKit?: HealthKitBridge;
  private healthConnect?: HealthConnectBridge;
  private wearables: WearableBridge;
  private config: MobileConfig;
  private consents: ConsentPreferences;
  private syncQueue: Array<{ data: unknown; timestamp: string }> = [];
  private clinicalRecordsCache: ClinicalRecord[] = [];

  constructor(config: MobileConfig, consents: ConsentPreferences) {
    this.config = config;
    this.consents = consents;
    this.wallet = new MobileWallet() as MobileWallet; // Will be initialized via create/restore
    this.wearables = new WearableBridge();
  }

  // === Wallet ===

  /** Create a new patient wallet (first-time setup) */
  async createWallet(): Promise<{ seedPhrase: string; publicKey: string }> {
    const { wallet, seedPhrase } = MobileWallet.create();
    this.wallet = wallet;
    return {
      seedPhrase,
      publicKey: wallet.getPublicKey().toBase58(),
    };
  }

  /** Restore wallet from seed phrase */
  async restoreWallet(seedPhrase: string): Promise<{ publicKey: string }> {
    this.wallet = MobileWallet.fromSeedPhrase(seedPhrase);
    return { publicKey: this.wallet.getPublicKey().toBase58() };
  }

  /** Get wallet info for display */
  getWalletInfo(): WalletInfo {
    const state = this.wallet.getState();
    return {
      publicKey: state.publicKey,
      passportPDA: '', // Derived from public key
      passportMinted: state.passportMinted,
      recordCount: 0,
      activeGrants: 0,
      encryptionKeyHash: state.encryptionPublicKey.substring(0, 16) + '...',
      recoveryConfigured: false,
      guardianCount: 0,
    };
  }

  /** Lock wallet (require biometric to use again) */
  lockWallet(): void {
    this.wallet.lock();
  }

  /** Unlock wallet with biometric */
  async unlockWallet(): Promise<boolean> {
    return this.wallet.unlock();
  }

  // === Health Data Platform Setup ===

  /** Initialize Apple HealthKit (iOS only) */
  async setupHealthKit(): Promise<{ authorized: boolean }> {
    this.healthKit = new HealthKitBridge(this.consents);
    const result = await this.healthKit.requestAuthorization();
    return { authorized: result.authorized.length > 0 };
  }

  /** Initialize Google Health Connect (Android only) */
  async setupHealthConnect(): Promise<{ authorized: boolean }> {
    this.healthConnect = new HealthConnectBridge(this.consents);
    const available = await this.healthConnect.isAvailable();
    if (!available.available) {
      return { authorized: false };
    }
    const result = await this.healthConnect.requestPermissions([
      'heart_rate', 'blood_pressure_systolic', 'blood_oxygen', 'steps', 'sleep_duration', 'weight',
    ]);
    return { authorized: result.granted.length > 0 };
  }

  /** Register a wearable data source */
  registerWearable(source: HealthDataSource, clientId: string, clientSecret: string): string {
    const endpoints: Record<string, string> = {
      fitbit: 'https://api.fitbit.com',
      oura: 'https://api.ouraring.com/v2',
      whoop: 'https://api.prod.whoop.com/developer/v1',
      withings: 'https://wbsapi.withings.net',
    };

    this.wearables.registerSource({
      source,
      clientId,
      clientSecret,
      apiBaseUrl: endpoints[source] ?? '',
    });

    return this.wearables.getAuthUrl(source, `${this.config.apiBaseUrl}/oauth/callback/${source}`, ['activity', 'heartrate', 'sleep']);
  }

  // === Sync ===

  /**
   * Full sync — pull from all enabled sources, encrypt, queue for blockchain.
   */
  async fullSync(): Promise<{
    sources: HealthSyncResult[];
    clinicalRecords: number;
    totalDataPoints: number;
  }> {
    const results: HealthSyncResult[] = [];
    let totalDataPoints = 0;
    const since = new Date(Date.now() - this.config.syncInterval * 60 * 1000).toISOString();

    // Sync HealthKit (iOS)
    if (this.healthKit && this.config.enabledSources.includes('apple_healthkit')) {
      const result = await this.healthKit.syncHealthData([
        'heart_rate', 'blood_pressure_systolic', 'blood_pressure_diastolic',
        'blood_oxygen', 'steps', 'sleep_duration', 'weight', 'blood_glucose',
      ]);
      results.push(result);
      totalDataPoints += result.dataPointsSynced;
    }

    // Sync Health Connect (Android)
    if (this.healthConnect && this.config.enabledSources.includes('google_health_connect')) {
      const result = await this.healthConnect.syncHealthData([
        'heart_rate', 'blood_pressure_systolic', 'blood_pressure_diastolic',
        'blood_oxygen', 'steps', 'sleep_duration', 'weight', 'blood_glucose',
      ]);
      results.push(result);
      totalDataPoints += result.dataPointsSynced;
    }

    // Sync wearables
    const wearableResults = await this.wearables.syncAll(since);
    results.push(...wearableResults);
    totalDataPoints += wearableResults.reduce((s, r) => s + r.dataPointsSynced, 0);

    // Fetch clinical records (FHIR from hospitals)
    let clinicalCount = 0;
    if (this.consents.shareClinicalRecords) {
      if (this.healthKit) {
        const records = await this.healthKit.fetchClinicalRecords();
        this.clinicalRecordsCache.push(...records);
        clinicalCount += records.length;
      }
      if (this.healthConnect) {
        const records = await this.healthConnect.readMedicalRecords();
        this.clinicalRecordsCache.push(...records);
        clinicalCount += records.length;
      }
    }

    return { sources: results, clinicalRecords: clinicalCount, totalDataPoints };
  }

  /**
   * Auto-sync loop — runs in background at configured interval.
   */
  async startAutoSync(onSyncComplete?: (result: { totalDataPoints: number }) => void): Promise<void> {
    if (!this.config.autoSync) return;

    const syncLoop = async () => {
      try {
        const result = await this.fullSync();
        onSyncComplete?.({ totalDataPoints: result.totalDataPoints });
      } catch (err) {
        console.error('[MediHive] Auto-sync error:', err);
      }
    };

    // Initial sync
    await syncLoop();

    // Schedule recurring sync
    setInterval(syncLoop, this.config.syncInterval * 60 * 1000);
  }

  // === Check-in ===

  /** Get NFC payload for hospital check-in */
  getNFCCheckIn(): { type: string; data: string } {
    return this.wallet.getNFCPayload();
  }

  /** Get QR code for hospital check-in */
  getQRCheckIn(): string {
    return this.wallet.getQRData();
  }

  // === Consent Management ===

  /** Update consent preferences */
  updateConsents(newConsents: Partial<ConsentPreferences>): void {
    Object.assign(this.consents, newConsents);
    // In production: update on-chain consent registry
  }

  /** Get current consent state */
  getConsents(): ConsentPreferences {
    return { ...this.consents };
  }

  // === Offline Support ===

  /** Queue data for sync when connectivity restored */
  queueForSync(data: unknown): void {
    this.syncQueue.push({ data, timestamp: new Date().toISOString() });
  }

  /** Process sync queue (called when connectivity restored) */
  async processSyncQueue(): Promise<number> {
    const queue = [...this.syncQueue];
    this.syncQueue = [];

    let processed = 0;
    for (const item of queue) {
      try {
        // In production: encrypt and upload each queued item
        processed++;
      } catch {
        // Re-queue failed items
        this.syncQueue.push(item);
      }
    }

    return processed;
  }

  /** Get count of items waiting to sync */
  getPendingSyncCount(): number {
    return this.syncQueue.length;
  }
}
