import { HealthDataPoint, HealthDataType, HealthSyncResult, ClinicalRecord, ConsentPreferences } from '../types';

/**
 * Apple HealthKit Bridge — Reads health data from iPhone/Apple Watch.
 *
 * Integration points:
 * 1. HealthKit Framework (vitals, activity, sleep, nutrition)
 *    - Requires user opt-in per data type
 *    - Data sent directly from HealthKit to app (not through Apple servers)
 *    - Background delivery for continuous sync
 *
 * 2. Health Records API (FHIR clinical data)
 *    - Patients download medical records from hospitals to iPhone
 *    - Uses HKFHIRResource class (FHIR R4 resources)
 *    - Supports: allergies, conditions, immunizations, labs, medications, procedures, vitals
 *
 * 3. Apple CDA Documents
 *    - Continuity of Care Documents from hospitals
 *    - Parsed into FHIR by Apple's Health Records feature
 *
 * In production: This TypeScript code generates the API contract.
 * Actual iOS implementation uses Swift + HealthKit framework.
 * React Native bridge via react-native-health or expo-health.
 *
 * Privacy: Apple requires NSHealthShareUsageDescription + NSHealthUpdateUsageDescription
 * in Info.plist. Data NEVER leaves device without explicit user action.
 */

// HealthKit data type identifiers (maps to HKQuantityTypeIdentifier)
const HEALTHKIT_TYPE_MAP: Record<HealthDataType, string> = {
  heart_rate: 'HKQuantityTypeIdentifierHeartRate',
  heart_rate_variability: 'HKQuantityTypeIdentifierHeartRateVariabilitySDNN',
  resting_heart_rate: 'HKQuantityTypeIdentifierRestingHeartRate',
  blood_pressure_systolic: 'HKQuantityTypeIdentifierBloodPressureSystolic',
  blood_pressure_diastolic: 'HKQuantityTypeIdentifierBloodPressureDiastolic',
  blood_oxygen: 'HKQuantityTypeIdentifierOxygenSaturation',
  respiratory_rate: 'HKQuantityTypeIdentifierRespiratoryRate',
  body_temperature: 'HKQuantityTypeIdentifierBodyTemperature',
  steps: 'HKQuantityTypeIdentifierStepCount',
  distance_walking: 'HKQuantityTypeIdentifierDistanceWalkingRunning',
  active_energy_burned: 'HKQuantityTypeIdentifierActiveEnergyBurned',
  basal_energy_burned: 'HKQuantityTypeIdentifierBasalEnergyBurned',
  exercise_minutes: 'HKQuantityTypeIdentifierAppleExerciseTime',
  stand_hours: 'HKQuantityTypeIdentifierAppleStandTime',
  flights_climbed: 'HKQuantityTypeIdentifierFlightsClimbed',
  vo2_max: 'HKQuantityTypeIdentifierVO2Max',
  sleep_duration: 'HKCategoryTypeIdentifierSleepAnalysis',
  sleep_deep: 'HKCategoryTypeIdentifierSleepAnalysis',
  sleep_rem: 'HKCategoryTypeIdentifierSleepAnalysis',
  sleep_light: 'HKCategoryTypeIdentifierSleepAnalysis',
  sleep_awake: 'HKCategoryTypeIdentifierSleepAnalysis',
  weight: 'HKQuantityTypeIdentifierBodyMass',
  height: 'HKQuantityTypeIdentifierHeight',
  bmi: 'HKQuantityTypeIdentifierBodyMassIndex',
  body_fat_percentage: 'HKQuantityTypeIdentifierBodyFatPercentage',
  lean_body_mass: 'HKQuantityTypeIdentifierLeanBodyMass',
  waist_circumference: 'HKQuantityTypeIdentifierWaistCircumference',
  dietary_calories: 'HKQuantityTypeIdentifierDietaryEnergyConsumed',
  dietary_protein: 'HKQuantityTypeIdentifierDietaryProtein',
  dietary_carbs: 'HKQuantityTypeIdentifierDietaryCarbohydrates',
  dietary_fat: 'HKQuantityTypeIdentifierDietaryFatTotal',
  dietary_fiber: 'HKQuantityTypeIdentifierDietaryFiber',
  dietary_sugar: 'HKQuantityTypeIdentifierDietarySugar',
  water_intake: 'HKQuantityTypeIdentifierDietaryWater',
  blood_glucose: 'HKQuantityTypeIdentifierBloodGlucose',
  insulin_delivery: 'HKQuantityTypeIdentifierInsulinDelivery',
  a1c: 'HKQuantityTypeIdentifierBloodGlucose', // Derived
  cholesterol_total: 'HKQuantityTypeIdentifierDietaryCholesterol',
  cholesterol_hdl: 'HKQuantityTypeIdentifierDietaryCholesterol',
  cholesterol_ldl: 'HKQuantityTypeIdentifierDietaryCholesterol',
  triglycerides: 'HKQuantityTypeIdentifierDietaryCholesterol',
};

// FHIR resource types available via Apple Health Records
const CLINICAL_RECORD_TYPES = [
  'HKClinicalTypeIdentifierAllergyRecord',
  'HKClinicalTypeIdentifierConditionRecord',
  'HKClinicalTypeIdentifierImmunizationRecord',
  'HKClinicalTypeIdentifierLabResultRecord',
  'HKClinicalTypeIdentifierMedicationRecord',
  'HKClinicalTypeIdentifierProcedureRecord',
  'HKClinicalTypeIdentifierVitalSignRecord',
  'HKClinicalTypeIdentifierCoverageRecord',
] as const;

export class HealthKitBridge {
  private consents: ConsentPreferences;
  private lastSyncTimestamps: Map<HealthDataType, string> = new Map();

  constructor(consents: ConsentPreferences) {
    this.consents = consents;
  }

  /**
   * Request HealthKit authorization.
   * Must be called before any data access.
   * Returns which data types the user authorized.
   *
   * In React Native: calls HKHealthStore.requestAuthorization()
   */
  async requestAuthorization(): Promise<{
    authorized: HealthDataType[];
    denied: HealthDataType[];
    clinicalRecordsAuthorized: boolean;
  }> {
    const readTypes = this.getRequestedReadTypes();
    const clinicalTypes = this.consents.shareClinicalRecords ? CLINICAL_RECORD_TYPES : [];

    // In production: native bridge call
    // HKHealthStore.requestAuthorization(toShare: [], read: readTypes + clinicalTypes)
    console.log(`[HealthKit] Requesting authorization for ${readTypes.length} data types + ${clinicalTypes.length} clinical types`);

    // Simulate authorization (in production: actual HealthKit callback)
    return {
      authorized: readTypes.map((_, i) => Object.keys(HEALTHKIT_TYPE_MAP)[i] as HealthDataType),
      denied: [],
      clinicalRecordsAuthorized: this.consents.shareClinicalRecords,
    };
  }

  /**
   * Sync health data from HealthKit to MediVault.
   * Only syncs data types the user has consented to share.
   * Only fetches data newer than the last sync timestamp.
   */
  async syncHealthData(
    dataTypes: HealthDataType[],
    onProgress?: (type: HealthDataType, count: number) => void
  ): Promise<HealthSyncResult> {
    const dataPoints: HealthDataPoint[] = [];
    const errors: string[] = [];

    for (const type of dataTypes) {
      if (!this.isTypeConsented(type)) {
        continue;
      }

      try {
        const lastSync = this.lastSyncTimestamps.get(type) ?? new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const points = await this.queryHealthKit(type, lastSync);
        dataPoints.push(...points);
        this.lastSyncTimestamps.set(type, new Date().toISOString());
        onProgress?.(type, points.length);
      } catch (err) {
        errors.push(`${type}: ${err instanceof Error ? err.message : 'unknown error'}`);
      }
    }

    // In production: encrypt and upload to IPFS, mint Record NFTs
    return {
      source: 'apple_healthkit',
      dataPointsSynced: dataPoints.length,
      newRecordsMinted: 0, // Would be set after blockchain tx
      errors,
      lastSyncTimestamp: new Date().toISOString(),
    };
  }

  /**
   * Fetch FHIR clinical records from Apple Health Records.
   * These are medical records patients downloaded from their hospital portals.
   *
   * Uses HKClinicalRecord + HKFHIRResource API.
   */
  async fetchClinicalRecords(): Promise<ClinicalRecord[]> {
    if (!this.consents.shareClinicalRecords) {
      return [];
    }

    const records: ClinicalRecord[] = [];

    for (const clinicalType of CLINICAL_RECORD_TYPES) {
      // In production: HKSampleQuery with HKClinicalType
      // Each result contains a .fhirResource property with the FHIR R4 JSON
      const fhirResourceType = this.clinicalTypeToFHIR(clinicalType);

      // Simulated — in production, native bridge reads from HealthKit
      records.push({
        id: `hk-${clinicalType}-${Date.now()}`,
        resourceType: fhirResourceType,
        fhirData: {
          resourceType: fhirResourceType,
          id: `apple-${Date.now()}`,
          // Actual FHIR data would be here
        },
        source: 'Apple Health Records',
        receivedAt: new Date().toISOString(),
        syncedToBlockchain: false,
      });
    }

    return records;
  }

  /**
   * Enable background delivery for real-time vital sign monitoring.
   * Apple Watch data arrives as background updates.
   *
   * In production: HKObserverQuery for each authorized type.
   */
  async enableBackgroundDelivery(
    types: HealthDataType[],
    frequency: 'immediate' | 'hourly' | 'daily'
  ): Promise<void> {
    const hkFrequency = frequency === 'immediate' ? 1 : frequency === 'hourly' ? 2 : 3;

    for (const type of types) {
      const hkType = HEALTHKIT_TYPE_MAP[type];
      if (!hkType) continue;

      // In production: HKHealthStore.enableBackgroundDelivery(for: hkType, frequency: hkFrequency)
      console.log(`[HealthKit] Background delivery enabled: ${type} (${frequency})`);
    }
  }

  /**
   * Write data TO HealthKit (e.g., hospital vitals → patient's Apple Health).
   * This allows hospital-recorded vitals to appear in the patient's Health app.
   */
  async writeToHealthKit(dataPoints: HealthDataPoint[]): Promise<{ written: number; errors: string[] }> {
    const errors: string[] = [];
    let written = 0;

    for (const point of dataPoints) {
      const hkType = HEALTHKIT_TYPE_MAP[point.type];
      if (!hkType) {
        errors.push(`Unknown HealthKit type for ${point.type}`);
        continue;
      }

      // In production: HKHealthStore.save(HKQuantitySample(...))
      written++;
    }

    return { written, errors };
  }

  /**
   * Generate a FHIR Bundle from HealthKit data for blockchain storage.
   */
  dataPointsToFHIRBundle(dataPoints: HealthDataPoint[]): object {
    return {
      resourceType: 'Bundle',
      type: 'collection',
      entry: dataPoints.map((dp) => ({
        resource: {
          resourceType: 'Observation',
          status: 'final',
          category: [{ coding: [{ system: 'http://terminology.hl7.org/CodeSystem/observation-category', code: this.getObservationCategory(dp.type) }] }],
          code: { coding: [{ system: 'http://loinc.org', code: this.getLoincCode(dp.type), display: dp.type.replace(/_/g, ' ') }] },
          effectiveDateTime: dp.timestamp,
          valueQuantity: { value: dp.value, unit: dp.unit },
          device: dp.deviceName ? { display: dp.deviceName } : undefined,
        },
      })),
    };
  }

  // === Private ===

  private getRequestedReadTypes(): string[] {
    const types: string[] = [];
    if (this.consents.shareVitals) {
      types.push(
        HEALTHKIT_TYPE_MAP.heart_rate,
        HEALTHKIT_TYPE_MAP.blood_pressure_systolic,
        HEALTHKIT_TYPE_MAP.blood_oxygen,
        HEALTHKIT_TYPE_MAP.respiratory_rate,
        HEALTHKIT_TYPE_MAP.body_temperature,
        HEALTHKIT_TYPE_MAP.heart_rate_variability,
        HEALTHKIT_TYPE_MAP.resting_heart_rate,
      );
    }
    if (this.consents.shareActivity) {
      types.push(
        HEALTHKIT_TYPE_MAP.steps,
        HEALTHKIT_TYPE_MAP.active_energy_burned,
        HEALTHKIT_TYPE_MAP.exercise_minutes,
        HEALTHKIT_TYPE_MAP.vo2_max,
      );
    }
    if (this.consents.shareSleep) {
      types.push(HEALTHKIT_TYPE_MAP.sleep_duration);
    }
    if (this.consents.shareNutrition) {
      types.push(
        HEALTHKIT_TYPE_MAP.dietary_calories,
        HEALTHKIT_TYPE_MAP.water_intake,
        HEALTHKIT_TYPE_MAP.blood_glucose,
      );
    }
    return [...new Set(types)];
  }

  private isTypeConsented(type: HealthDataType): boolean {
    const vitals: HealthDataType[] = ['heart_rate', 'heart_rate_variability', 'resting_heart_rate', 'blood_pressure_systolic', 'blood_pressure_diastolic', 'blood_oxygen', 'respiratory_rate', 'body_temperature'];
    const activity: HealthDataType[] = ['steps', 'distance_walking', 'active_energy_burned', 'basal_energy_burned', 'exercise_minutes', 'stand_hours', 'flights_climbed', 'vo2_max'];
    const sleep: HealthDataType[] = ['sleep_duration', 'sleep_deep', 'sleep_rem', 'sleep_light', 'sleep_awake'];
    const nutrition: HealthDataType[] = ['dietary_calories', 'dietary_protein', 'dietary_carbs', 'dietary_fat', 'dietary_fiber', 'dietary_sugar', 'water_intake', 'blood_glucose', 'insulin_delivery'];

    if (vitals.includes(type)) return this.consents.shareVitals;
    if (activity.includes(type)) return this.consents.shareActivity;
    if (sleep.includes(type)) return this.consents.shareSleep;
    if (nutrition.includes(type)) return this.consents.shareNutrition;
    return false;
  }

  private async queryHealthKit(type: HealthDataType, since: string): Promise<HealthDataPoint[]> {
    // In production: HKSampleQuery with predicate (startDate > since)
    // Returns actual HealthKit samples converted to our format
    return [];
  }

  private clinicalTypeToFHIR(clinicalType: string): string {
    const map: Record<string, string> = {
      HKClinicalTypeIdentifierAllergyRecord: 'AllergyIntolerance',
      HKClinicalTypeIdentifierConditionRecord: 'Condition',
      HKClinicalTypeIdentifierImmunizationRecord: 'Immunization',
      HKClinicalTypeIdentifierLabResultRecord: 'Observation',
      HKClinicalTypeIdentifierMedicationRecord: 'MedicationRequest',
      HKClinicalTypeIdentifierProcedureRecord: 'Procedure',
      HKClinicalTypeIdentifierVitalSignRecord: 'Observation',
      HKClinicalTypeIdentifierCoverageRecord: 'Coverage',
    };
    return map[clinicalType] ?? 'Unknown';
  }

  private getObservationCategory(type: HealthDataType): string {
    if (['heart_rate', 'blood_pressure_systolic', 'blood_pressure_diastolic', 'blood_oxygen', 'respiratory_rate', 'body_temperature'].includes(type)) return 'vital-signs';
    if (['steps', 'active_energy_burned', 'exercise_minutes'].includes(type)) return 'activity';
    if (type.startsWith('sleep_')) return 'sleep';
    if (type.startsWith('blood_glucose') || type.startsWith('cholesterol')) return 'laboratory';
    return 'survey';
  }

  private getLoincCode(type: HealthDataType): string {
    const codes: Partial<Record<HealthDataType, string>> = {
      heart_rate: '8867-4', blood_pressure_systolic: '8480-6', blood_pressure_diastolic: '8462-4',
      blood_oxygen: '2708-6', respiratory_rate: '9279-1', body_temperature: '8310-5',
      weight: '29463-7', height: '8302-2', bmi: '39156-5', blood_glucose: '2339-0',
      steps: '55423-8', sleep_duration: '93832-4',
    };
    return codes[type] ?? '00000-0';
  }
}
