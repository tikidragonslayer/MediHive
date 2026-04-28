/**
 * Background sync engine that periodically polls an EHR for patient updates,
 * detects changes, converts FHIR resources to MediHive format, and queues
 * blockchain sync operations.
 */

import type { FHIRResource } from '../../bridge-core/src/fhir-types';
import type { EHRAdapter } from './adapters/base';
import type {
  MediHiveRecord,
  MediHiveRecordType,
  SyncOptions,
  SyncEvent,
  SyncEventType,
  ConflictPolicy,
} from './types';
import { DEFAULT_CONFLICT_POLICY } from './types';
import {
  PatientSerializer,
  ObservationSerializer,
  ConditionSerializer,
  MedicationRequestSerializer,
  AllergySerializer,
  EncounterSerializer,
  DocumentReferenceSerializer,
  DiagnosticReportSerializer,
} from './serializers/index';

// ─── Event Emitter (minimal, no external deps) ─────────────────────────────

type SyncEventListener = (event: SyncEvent) => void;

class SyncEventEmitter {
  private listeners: Map<SyncEventType | '*', SyncEventListener[]> = new Map();

  on(type: SyncEventType | '*', listener: SyncEventListener): void {
    const existing = this.listeners.get(type) ?? [];
    existing.push(listener);
    this.listeners.set(type, existing);
  }

  off(type: SyncEventType | '*', listener: SyncEventListener): void {
    const existing = this.listeners.get(type);
    if (!existing) return;
    const index = existing.indexOf(listener);
    if (index !== -1) existing.splice(index, 1);
  }

  emit(event: SyncEvent): void {
    const typeListeners = this.listeners.get(event.type) ?? [];
    const wildcardListeners = this.listeners.get('*') ?? [];
    for (const listener of [...typeListeners, ...wildcardListeners]) {
      listener(event);
    }
  }
}

// ─── Sync Queue Item ────────────────────────────────────────────────────────

interface SyncQueueItem {
  record: MediHiveRecord;
  operation: 'create' | 'update';
  addedAt: string;
}

// ─── Default Sync Options ───────────────────────────────────────────────────

const DEFAULT_SYNC_OPTIONS: SyncOptions = {
  intervalMs: 300_000, // 5 minutes
  batchSize: 100,
  resourceTypes: [
    'patient',
    'vitals',
    'condition',
    'medication',
    'allergy',
    'encounter',
    'document',
    'diagnostic-report',
  ],
};

// ─── Sync Engine ────────────────────────────────────────────────────────────

export class SyncEngine {
  private adapter: EHRAdapter;
  private options: SyncOptions;
  private conflictPolicy: ConflictPolicy;
  private emitter: SyncEventEmitter = new SyncEventEmitter();
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private running = false;

  /**
   * Tracks the last known _lastUpdated per resource type per patient.
   * Key format: `${patientId}:${resourceType}`
   */
  private lastUpdatedMap: Map<string, string> = new Map();

  /**
   * Queue of records pending blockchain sync.
   */
  private syncQueue: SyncQueueItem[] = [];

  /**
   * In-memory store of known records for change detection.
   * Key: `${sourceSystem}:${sourceId}`
   */
  private knownRecords: Map<string, MediHiveRecord> = new Map();

  constructor(
    adapter: EHRAdapter,
    options?: Partial<SyncOptions>,
    conflictPolicy?: Partial<ConflictPolicy>
  ) {
    this.adapter = adapter;
    this.options = { ...DEFAULT_SYNC_OPTIONS, ...options };
    this.conflictPolicy = { ...DEFAULT_CONFLICT_POLICY, ...conflictPolicy };
  }

  /** Subscribe to sync events */
  on(type: SyncEventType | '*', listener: SyncEventListener): void {
    this.emitter.on(type, listener);
  }

  /** Unsubscribe from sync events */
  off(type: SyncEventType | '*', listener: SyncEventListener): void {
    this.emitter.off(type, listener);
  }

  /** Start the background polling loop */
  start(): void {
    if (this.running) return;
    this.running = true;

    // Run immediately, then on interval
    void this.poll();
    this.intervalId = setInterval(() => void this.poll(), this.options.intervalMs);
  }

  /** Stop the background polling loop */
  stop(): void {
    this.running = false;
    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  /** Get current queue depth */
  get queueSize(): number {
    return this.syncQueue.length;
  }

  /** Get and clear the sync queue (for external consumers to process) */
  drainQueue(): SyncQueueItem[] {
    const items = [...this.syncQueue];
    this.syncQueue = [];
    return items;
  }

  /** Manually trigger a sync for a specific patient */
  async syncPatient(patientId: string): Promise<void> {
    await this.pollPatient(patientId);
  }

  // ─── Private polling logic ──────────────────────────────────────────────

  private async poll(): Promise<void> {
    const timestamp = new Date().toISOString();

    this.emitter.emit({
      type: 'sync:start',
      timestamp,
    });

    try {
      // In a real implementation, we would maintain a list of tracked patients.
      // For now, the engine provides syncPatient() for explicit triggers
      // and the poll() is a hook for future patient-list iteration.

      this.emitter.emit({
        type: 'sync:complete',
        timestamp: new Date().toISOString(),
        details: `Sync cycle completed. Queue depth: ${this.syncQueue.length}`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.emitter.emit({
        type: 'sync:error',
        timestamp: new Date().toISOString(),
        error: message,
      });
    }
  }

  private async pollPatient(patientId: string): Promise<void> {
    const types = this.options.resourceTypes;

    for (const resourceType of types) {
      try {
        await this.syncResourceType(patientId, resourceType);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.emitter.emit({
          type: 'sync:error',
          timestamp: new Date().toISOString(),
          patientId,
          resourceType,
          error: message,
        });
      }
    }
  }

  private async syncResourceType(
    patientId: string,
    resourceType: MediHiveRecordType
  ): Promise<void> {
    const resources = await this.fetchResources(patientId, resourceType);

    for (const resource of resources) {
      const fhirResource = resource as FHIRResource & { id?: string };
      const sourceId = fhirResource.id ?? '';
      const recordKey = `${this.adapter.name}:${sourceId}`;
      const existing = this.knownRecords.get(recordKey);

      const record = this.convertToMediHiveRecord(
        fhirResource,
        resourceType,
        patientId,
        sourceId
      );

      if (!existing) {
        // New record
        this.knownRecords.set(recordKey, record);
        this.enqueue(record, 'create');
      } else {
        // Check for changes by comparing updatedAt or data
        const hasChanged = this.detectChange(existing, record);
        if (hasChanged) {
          const resolvedRecord = this.resolveConflict(
            existing,
            record,
            resourceType
          );
          this.knownRecords.set(recordKey, resolvedRecord);
          this.enqueue(resolvedRecord, 'update');
        }
      }
    }
  }

  private async fetchResources(
    patientId: string,
    resourceType: MediHiveRecordType
  ): Promise<unknown[]> {
    switch (resourceType) {
      case 'patient':
        return [await this.adapter.getPatient(patientId)];
      case 'vitals':
        return await this.adapter.getObservations(patientId, 'vital-signs');
      case 'condition':
        return await this.adapter.getConditions(patientId);
      case 'medication':
        return await this.adapter.getMedications(patientId);
      case 'allergy':
        return await this.adapter.getAllergies(patientId);
      case 'encounter':
        return await this.adapter.getEncounters(patientId);
      case 'document':
        return await this.adapter.getDocuments(patientId);
      case 'diagnostic-report':
        return await this.adapter.getDiagnosticReports(patientId);
    }
  }

  private convertToMediHiveRecord(
    resource: FHIRResource,
    resourceType: MediHiveRecordType,
    patientId: string,
    sourceId: string
  ): MediHiveRecord {
    const now = new Date().toISOString();
    let data;

    switch (resource.resourceType) {
      case 'Patient':
        data = PatientSerializer.fromFHIR(resource);
        break;
      case 'Observation':
        data = ObservationSerializer.fromFHIR(resource);
        break;
      case 'Condition':
        data = ConditionSerializer.fromFHIR(resource);
        break;
      case 'MedicationRequest':
        data = MedicationRequestSerializer.fromFHIR(resource);
        break;
      case 'AllergyIntolerance':
        data = AllergySerializer.fromFHIR(resource);
        break;
      case 'Encounter':
        data = EncounterSerializer.fromFHIR(resource);
        break;
      case 'DocumentReference':
        data = DocumentReferenceSerializer.fromFHIR(resource);
        break;
      case 'DiagnosticReport':
        data = DiagnosticReportSerializer.fromFHIR(resource);
        break;
    }

    // Extract clinical date from the resource
    const clinicalDate = this.extractClinicalDate(resource) ?? now;

    return {
      id: crypto.randomUUID(),
      type: resourceType,
      patientId,
      sourceSystem: this.adapter.name,
      sourceId,
      createdAt: now,
      updatedAt: now,
      clinicalDate,
      data,
      version: 1,
    };
  }

  private extractClinicalDate(resource: FHIRResource): string | undefined {
    switch (resource.resourceType) {
      case 'Observation':
        return resource.effectiveDateTime;
      case 'Condition':
        return resource.recordedDate ?? resource.onsetDateTime;
      case 'MedicationRequest':
        return resource.authoredOn;
      case 'AllergyIntolerance':
        return resource.recordedDate;
      case 'Encounter':
        return resource.period?.start;
      case 'DocumentReference':
        return resource.date;
      case 'DiagnosticReport':
        return resource.effectiveDateTime;
      case 'Patient':
        return undefined;
    }
  }

  /**
   * Simple change detection by comparing JSON-serialized data payloads.
   */
  private detectChange(
    existing: MediHiveRecord,
    incoming: MediHiveRecord
  ): boolean {
    return JSON.stringify(existing.data) !== JSON.stringify(incoming.data);
  }

  /**
   * Resolve conflicts between existing MediHive record and incoming EHR record.
   * - EHR wins for demographics, vitals, conditions, meds, allergies, encounters, reports
   * - MediHive wins for blockchain-anchored documents
   */
  private resolveConflict(
    existing: MediHiveRecord,
    incoming: MediHiveRecord,
    resourceType: MediHiveRecordType
  ): MediHiveRecord {
    const policy = this.conflictPolicy[resourceType];

    if (policy === 'medihive-wins' && existing.solanaTxSignature) {
      // MediHive record is blockchain-anchored; keep it
      this.emitter.emit({
        type: 'sync:conflict-resolved',
        timestamp: new Date().toISOString(),
        patientId: existing.patientId,
        resourceType,
        resourceId: existing.sourceId,
        details: `Conflict resolved: MediHive wins (blockchain-anchored). Source ID: ${existing.sourceId}`,
      });
      return existing;
    }

    // EHR wins: update the record with incoming data
    this.emitter.emit({
      type: 'sync:conflict-resolved',
      timestamp: new Date().toISOString(),
      patientId: incoming.patientId,
      resourceType,
      resourceId: incoming.sourceId,
      details: `Conflict resolved: EHR wins. Source ID: ${incoming.sourceId}`,
    });

    return {
      ...existing,
      data: incoming.data,
      updatedAt: new Date().toISOString(),
      clinicalDate: incoming.clinicalDate,
      version: existing.version + 1,
    };
  }

  private enqueue(record: MediHiveRecord, operation: 'create' | 'update'): void {
    this.syncQueue.push({
      record,
      operation,
      addedAt: new Date().toISOString(),
    });

    this.emitter.emit({
      type: 'sync:resource-updated',
      timestamp: new Date().toISOString(),
      patientId: record.patientId,
      resourceType: record.type,
      resourceId: record.sourceId,
      details: `${operation}: ${record.type} (${record.sourceId})`,
    });
  }
}
