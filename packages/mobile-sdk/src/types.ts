/**
 * Mobile SDK types — platform-agnostic health data model.
 *
 * Data from Apple HealthKit, Google Health Connect, Fitbit, Garmin, etc.
 * is normalized into these types before syncing to blockchain.
 */

export type HealthDataSource =
  | 'apple_healthkit'
  | 'google_health_connect'
  | 'fitbit'
  | 'garmin'
  | 'samsung_health'
  | 'oura'
  | 'whoop'
  | 'withings'
  | 'manual_entry';

export interface HealthDataPoint {
  id: string;
  type: HealthDataType;
  value: number;
  unit: string;
  timestamp: string;
  source: HealthDataSource;
  deviceName?: string;
  metadata?: Record<string, unknown>;
}

export type HealthDataType =
  // Vitals
  | 'heart_rate'
  | 'heart_rate_variability'
  | 'resting_heart_rate'
  | 'blood_pressure_systolic'
  | 'blood_pressure_diastolic'
  | 'blood_oxygen'
  | 'respiratory_rate'
  | 'body_temperature'
  // Activity
  | 'steps'
  | 'distance_walking'
  | 'active_energy_burned'
  | 'basal_energy_burned'
  | 'exercise_minutes'
  | 'stand_hours'
  | 'flights_climbed'
  | 'vo2_max'
  // Sleep
  | 'sleep_duration'
  | 'sleep_deep'
  | 'sleep_rem'
  | 'sleep_light'
  | 'sleep_awake'
  // Body measurements
  | 'weight'
  | 'height'
  | 'bmi'
  | 'body_fat_percentage'
  | 'lean_body_mass'
  | 'waist_circumference'
  // Nutrition
  | 'dietary_calories'
  | 'dietary_protein'
  | 'dietary_carbs'
  | 'dietary_fat'
  | 'dietary_fiber'
  | 'dietary_sugar'
  | 'water_intake'
  // Lab / Clinical (from Apple Health Records / Health Connect Medical Records)
  | 'blood_glucose'
  | 'insulin_delivery'
  | 'a1c'
  | 'cholesterol_total'
  | 'cholesterol_hdl'
  | 'cholesterol_ldl'
  | 'triglycerides';

export interface HealthSyncResult {
  source: HealthDataSource;
  dataPointsSynced: number;
  newRecordsMinted: number;
  errors: string[];
  lastSyncTimestamp: string;
}

export interface ClinicalRecord {
  id: string;
  resourceType: string; // FHIR resource type
  fhirData: unknown; // Raw FHIR R4 resource
  source: string; // e.g., "Epic MyChart", "Cerner HealtheLife"
  receivedAt: string;
  syncedToBlockchain: boolean;
  blockchainTx?: string;
}

export interface ConsentPreferences {
  shareVitals: boolean;
  shareActivity: boolean;
  shareSleep: boolean;
  shareNutrition: boolean;
  shareClinicalRecords: boolean;
  shareWithResearch: boolean;
  autoSyncEnabled: boolean;
  syncFrequencyMinutes: number;
}

export interface WalletInfo {
  publicKey: string;
  passportPDA: string;
  passportMinted: boolean;
  recordCount: number;
  activeGrants: number;
  encryptionKeyHash: string;
  recoveryConfigured: boolean;
  guardianCount: number;
}

export interface MobileConfig {
  apiBaseUrl: string;
  solanaRpcUrl: string;
  pinataGateway: string;
  autoSync: boolean;
  syncInterval: number;
  enabledSources: HealthDataSource[];
}
