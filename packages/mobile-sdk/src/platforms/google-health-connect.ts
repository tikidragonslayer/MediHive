import { HealthDataPoint, HealthDataType, HealthSyncResult, ClinicalRecord, ConsentPreferences } from '../types';

/**
 * Google Health Connect Bridge — Android health data integration.
 *
 * Integration points:
 * 1. Health Connect API (Android 14+)
 *    - Unified health data store for all Android health apps
 *    - Replaces deprecated Google Fit API
 *    - Aggregates from Fitbit, Samsung Health, Oura, etc.
 *
 * 2. Medical Records API (NEW in Android 16)
 *    - Reads/writes FHIR medical data natively
 *    - Currently supports immunization records
 *    - More resource types coming 2026-2027
 *
 * 3. Android FHIR SDK (Kotlin)
 *    - Offline-capable FHIR data store
 *    - Syncs with FHIR servers
 *    - Google's Open Health Stack
 *
 * Permissions model:
 * - android.permission.health.READ_HEART_RATE
 * - android.permission.health.READ_BLOOD_PRESSURE
 * - android.permission.health.READ_STEPS
 * - android.permission.health.READ_MEDICAL_DATA_IMMUNIZATION (Android 16+)
 * - etc. (granular per data type)
 *
 * In production: Kotlin/Java + Health Connect Client library.
 * React Native bridge via react-native-health-connect.
 */

// Health Connect data type to Android permission mapping
const HEALTH_CONNECT_PERMISSIONS: Record<string, string> = {
  heart_rate: 'android.permission.health.READ_HEART_RATE',
  resting_heart_rate: 'android.permission.health.READ_RESTING_HEART_RATE',
  heart_rate_variability: 'android.permission.health.READ_HEART_RATE_VARIABILITY',
  blood_pressure_systolic: 'android.permission.health.READ_BLOOD_PRESSURE',
  blood_pressure_diastolic: 'android.permission.health.READ_BLOOD_PRESSURE',
  blood_oxygen: 'android.permission.health.READ_OXYGEN_SATURATION',
  respiratory_rate: 'android.permission.health.READ_RESPIRATORY_RATE',
  body_temperature: 'android.permission.health.READ_BODY_TEMPERATURE',
  steps: 'android.permission.health.READ_STEPS',
  distance_walking: 'android.permission.health.READ_DISTANCE',
  active_energy_burned: 'android.permission.health.READ_ACTIVE_CALORIES_BURNED',
  basal_energy_burned: 'android.permission.health.READ_BASAL_METABOLIC_RATE',
  exercise_minutes: 'android.permission.health.READ_EXERCISE',
  flights_climbed: 'android.permission.health.READ_FLOORS_CLIMBED',
  vo2_max: 'android.permission.health.READ_VO2_MAX',
  sleep_duration: 'android.permission.health.READ_SLEEP',
  weight: 'android.permission.health.READ_WEIGHT',
  height: 'android.permission.health.READ_HEIGHT',
  body_fat_percentage: 'android.permission.health.READ_BODY_FAT',
  lean_body_mass: 'android.permission.health.READ_LEAN_BODY_MASS',
  blood_glucose: 'android.permission.health.READ_BLOOD_GLUCOSE',
  dietary_calories: 'android.permission.health.READ_NUTRITION',
  water_intake: 'android.permission.health.READ_HYDRATION',
};

// Health Connect record types (maps to ReadRecordsRequest types)
const RECORD_TYPE_MAP: Record<HealthDataType, string> = {
  heart_rate: 'HeartRateRecord',
  heart_rate_variability: 'HeartRateVariabilityRmssdRecord',
  resting_heart_rate: 'RestingHeartRateRecord',
  blood_pressure_systolic: 'BloodPressureRecord',
  blood_pressure_diastolic: 'BloodPressureRecord',
  blood_oxygen: 'OxygenSaturationRecord',
  respiratory_rate: 'RespiratoryRateRecord',
  body_temperature: 'BodyTemperatureRecord',
  steps: 'StepsRecord',
  distance_walking: 'DistanceRecord',
  active_energy_burned: 'ActiveCaloriesBurnedRecord',
  basal_energy_burned: 'BasalMetabolicRateRecord',
  exercise_minutes: 'ExerciseSessionRecord',
  stand_hours: 'ExerciseSessionRecord',
  flights_climbed: 'FloorsClimbedRecord',
  vo2_max: 'Vo2MaxRecord',
  sleep_duration: 'SleepSessionRecord',
  sleep_deep: 'SleepSessionRecord',
  sleep_rem: 'SleepSessionRecord',
  sleep_light: 'SleepSessionRecord',
  sleep_awake: 'SleepSessionRecord',
  weight: 'WeightRecord',
  height: 'HeightRecord',
  bmi: 'WeightRecord', // Derived
  body_fat_percentage: 'BodyFatRecord',
  lean_body_mass: 'LeanBodyMassRecord',
  waist_circumference: 'WeightRecord', // No direct type
  dietary_calories: 'NutritionRecord',
  dietary_protein: 'NutritionRecord',
  dietary_carbs: 'NutritionRecord',
  dietary_fat: 'NutritionRecord',
  dietary_fiber: 'NutritionRecord',
  dietary_sugar: 'NutritionRecord',
  water_intake: 'HydrationRecord',
  blood_glucose: 'BloodGlucoseRecord',
  insulin_delivery: 'BloodGlucoseRecord', // Related
  a1c: 'BloodGlucoseRecord', // Derived
  cholesterol_total: 'NutritionRecord',
  cholesterol_hdl: 'NutritionRecord',
  cholesterol_ldl: 'NutritionRecord',
  triglycerides: 'NutritionRecord',
};

export class HealthConnectBridge {
  private consents: ConsentPreferences;
  private lastSyncTimestamps: Map<HealthDataType, string> = new Map();

  constructor(consents: ConsentPreferences) {
    this.consents = consents;
  }

  /**
   * Check if Health Connect is available on this device.
   * Health Connect requires Android 14+ or Health Connect app installed.
   */
  async isAvailable(): Promise<{ available: boolean; version?: string; needsInstall: boolean }> {
    // In production: HealthConnectClient.getOrCreate(context)
    // Catches HealthConnectNotInstalledException
    return { available: true, version: '1.0', needsInstall: false };
  }

  /**
   * Request permissions for health data types.
   * Android shows a system permission dialog for each data type.
   */
  async requestPermissions(types: HealthDataType[]): Promise<{
    granted: HealthDataType[];
    denied: HealthDataType[];
  }> {
    const permissions = types
      .map((t) => HEALTH_CONNECT_PERMISSIONS[t])
      .filter(Boolean);

    const uniquePerms = [...new Set(permissions)];
    console.log(`[HealthConnect] Requesting ${uniquePerms.length} permissions`);

    // In production: ActivityResultContract for PermissionController.createRequestPermissionResultContract()
    return { granted: types, denied: [] };
  }

  /**
   * Sync health data from Health Connect to MediVault.
   */
  async syncHealthData(
    dataTypes: HealthDataType[],
    onProgress?: (type: HealthDataType, count: number) => void
  ): Promise<HealthSyncResult> {
    const dataPoints: HealthDataPoint[] = [];
    const errors: string[] = [];

    for (const type of dataTypes) {
      try {
        const lastSync = this.lastSyncTimestamps.get(type) ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const points = await this.readRecords(type, lastSync);
        dataPoints.push(...points);
        this.lastSyncTimestamps.set(type, new Date().toISOString());
        onProgress?.(type, points.length);
      } catch (err) {
        errors.push(`${type}: ${err instanceof Error ? err.message : 'unknown'}`);
      }
    }

    return {
      source: 'google_health_connect',
      dataPointsSynced: dataPoints.length,
      newRecordsMinted: 0,
      errors,
      lastSyncTimestamp: new Date().toISOString(),
    };
  }

  /**
   * Read Medical Records (FHIR) from Health Connect.
   * Android 16+ Medical Records API.
   */
  async readMedicalRecords(): Promise<ClinicalRecord[]> {
    if (!this.consents.shareClinicalRecords) return [];

    // In production:
    // val request = ReadMedicalResourcesRequest(MedicalResourceType.IMMUNIZATION)
    // val response = healthConnectClient.readMedicalResources(request)
    // response.medicalResources.forEach { it.fhirResource }

    return [{
      id: `hc-medical-${Date.now()}`,
      resourceType: 'Immunization',
      fhirData: { resourceType: 'Immunization', status: 'completed' },
      source: 'Google Health Connect Medical Records',
      receivedAt: new Date().toISOString(),
      syncedToBlockchain: false,
    }];
  }

  /**
   * Write data TO Health Connect (e.g., hospital vitals → patient's Health Connect).
   */
  async writeRecords(dataPoints: HealthDataPoint[]): Promise<{ written: number; errors: string[] }> {
    const errors: string[] = [];
    let written = 0;

    for (const point of dataPoints) {
      const recordType = RECORD_TYPE_MAP[point.type];
      if (!recordType) {
        errors.push(`No Health Connect record type for ${point.type}`);
        continue;
      }

      // In production: healthConnectClient.insertRecords(listOf(record))
      written++;
    }

    return { written, errors };
  }

  /**
   * Register for data change notifications.
   * Notified when new health data arrives from any source.
   */
  async registerChangeListener(
    types: HealthDataType[],
    callback: (changes: HealthDataPoint[]) => void
  ): Promise<string> {
    const listenerId = `listener-${Date.now()}`;

    // In production:
    // healthConnectClient.registerForDataNotifications(
    //   DataNotification(recordType, DataNotification.CHANGE_TYPE_INSERT)
    // )

    console.log(`[HealthConnect] Change listener registered: ${listenerId} for ${types.length} types`);
    return listenerId;
  }

  /**
   * Get aggregated data (e.g., total steps today, average heart rate this week).
   */
  async getAggregates(
    type: HealthDataType,
    startTime: string,
    endTime: string,
    period: 'hour' | 'day' | 'week' | 'month'
  ): Promise<Array<{ periodStart: string; periodEnd: string; value: number; unit: string }>> {
    // In production: AggregateGroupByPeriodRequest
    return [];
  }

  // === Private ===

  private async readRecords(type: HealthDataType, since: string): Promise<HealthDataPoint[]> {
    const recordType = RECORD_TYPE_MAP[type];
    if (!recordType) return [];

    // In production:
    // val request = ReadRecordsRequest(
    //   recordType::class,
    //   timeRangeFilter = TimeRangeFilter.after(Instant.parse(since))
    // )
    // val response = healthConnectClient.readRecords(request)

    return [];
  }
}
