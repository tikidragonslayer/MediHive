/**
 * @medi-hive/bridge-fhir-adapter
 *
 * FHIR R4 adapter package for MediHive.
 * Provides bidirectional serializers, EHR adapters (Epic, Cerner),
 * and a background sync engine for keeping MediHive in sync with EHR systems.
 */

// Types and constants
export * from './types';

// Serializers
export {
  PatientSerializer,
  ObservationSerializer,
  ConditionSerializer,
  MedicationRequestSerializer,
  AllergySerializer,
  EncounterSerializer,
  DocumentReferenceSerializer,
  DiagnosticReportSerializer,
} from './serializers/index';

// Adapter interfaces and base class
export type { EHRAdapter } from './adapters/base';
export { BaseEHRAdapter } from './adapters/base';

// Concrete adapters
export { EpicAdapter } from './adapters/epic';
export { CernerAdapter } from './adapters/cerner';

// Sync engine
export { SyncEngine } from './sync-engine';
