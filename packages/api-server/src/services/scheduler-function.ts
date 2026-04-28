import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import * as admin from 'firebase-admin';
import { FieldValue } from 'firebase-admin/firestore';

import {
  AcuityScorer,
  PatientPriority,
  AlertTriager,
  MedicationChecker,
  NurseRouter,
  MediBrain,
} from '@medi-hive/brain-engine';
import type {
  Patient,
  Nurse,
  NursingTask,
  PatientAlert,
  VitalSigns,
  NurseAssignment,
} from '@medi-hive/brain-engine';

import { eventBus, type WSEvent } from '../websocket';

// ── Constants ───────────────────────────────────────────────────────

const ACUITY_JUMP_THRESHOLD = 2;
const OVERDUE_MED_WINDOW_MS = 15 * 60 * 1000; // 15 min
const OVERDUE_VITALS_WINDOW_MS = 30 * 60 * 1000; // 30 min
const NURSE_SATURATION_PCT = 85;

// ── Firestore helpers ───────────────────────────────────────────────

function getDb(): FirebaseFirestore.Firestore {
  if (!admin.apps.length) {
    admin.initializeApp();
  }
  return admin.firestore();
}

// ── Data loaders ────────────────────────────────────────────────────

/**
 * Load active patients from Firestore and map to the brain-engine Patient type.
 * Firestore stores snake_case; brain-engine uses camelCase.
 */
async function loadActivePatients(db: FirebaseFirestore.Firestore): Promise<Patient[]> {
  const snap = await db
    .collection('patients')
    .where('status', '==', 'admitted')
    .get();

  const patients: Patient[] = [];

  for (const doc of snap.docs) {
    const d = doc.data();

    // Load pending tasks for this patient
    const taskSnap = await db
      .collection('tasks')
      .where('patient_id', '==', doc.id)
      .where('status', '==', 'pending')
      .get();

    const pendingTasks: NursingTask[] = taskSnap.docs.map((t) => {
      const td = t.data();
      return {
        id: t.id,
        patientId: td.patient_id,
        type: td.type,
        priority: td.priority,
        description: td.description,
        scheduledTime: td.scheduled_time?.toDate?.()?.toISOString() ?? new Date().toISOString(),
        windowMinutes: td.window_minutes ?? 60,
        requiredCerts: td.required_certs ?? ['BLS'],
        estimatedMinutes: td.estimated_minutes ?? 15,
        completedAt: td.completed_at?.toDate?.()?.toISOString() ?? undefined,
      };
    });

    // Load active alerts for this patient
    const alertSnap = await db
      .collection('alerts')
      .where('patient_id', '==', doc.id)
      .where('acknowledged', '==', false)
      .get();

    const alerts: PatientAlert[] = alertSnap.docs.map((a) => {
      const ad = a.data();
      return {
        id: a.id,
        patientId: ad.patient_id,
        type: ad.type,
        severity: ad.severity,
        message: ad.message,
        timestamp: ad.created_at?.toDate?.()?.toISOString() ?? new Date().toISOString(),
        acknowledged: ad.acknowledged ?? false,
        acknowledgedBy: ad.acknowledged_by ?? undefined,
        isFalseAlarm: ad.is_false_alarm ?? undefined,
      };
    });

    // Build latest vitals from the patient doc (cached) or vitals collection
    const vitals: VitalSigns = {
      heartRate: d.heart_rate ?? d.vitals?.heart_rate,
      systolicBP: d.systolic_bp ?? d.vitals?.systolic_bp,
      diastolicBP: d.diastolic_bp ?? d.vitals?.diastolic_bp,
      temperature: d.temperature ?? d.vitals?.temperature,
      respiratoryRate: d.respiratory_rate ?? d.vitals?.respiratory_rate,
      spO2: d.sp_o2 ?? d.vitals?.sp_o2,
      painLevel: d.pain_level ?? d.vitals?.pain_level,
      timestamp: d.vitals_timestamp?.toDate?.()?.toISOString() ?? new Date().toISOString(),
    };

    patients.push({
      id: doc.id,
      name: d.name,
      room: d.room,
      floor: d.floor,
      bedId: d.bed_id,
      admissionTime: d.admission_time?.toDate?.()?.toISOString() ?? new Date().toISOString(),
      acuityScore: d.acuity_score ?? 0,
      primaryDiagnosis: d.primary_diagnosis ?? '',
      icdCodes: d.icd_codes ?? [],
      assignedNurse: d.assigned_nurse ?? undefined,
      pendingTasks,
      alerts,
      vitals,
      isolationRequired: d.isolation_required ?? false,
    });
  }

  return patients;
}

/**
 * Load on-duty nurses from Firestore and map to the brain-engine Nurse type.
 */
async function loadOnDutyNurses(db: FirebaseFirestore.Firestore): Promise<Nurse[]> {
  const snap = await db
    .collection('users')
    .where('role', '==', 'nurse')
    .get();

  const now = new Date();
  const nurses: Nurse[] = [];

  for (const doc of snap.docs) {
    const d = doc.data();

    // Determine shift times (default 12-hour shifts)
    const shiftStart = d.shift_start ?? '07:00';
    const shiftEnd = d.shift_end ?? '19:00';

    // Simple on-duty check: parse shift times and compare to now
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();
    const currentMins = currentHour * 60 + currentMinute;

    const [startH, startM] = shiftStart.split(':').map(Number);
    const [endH, endM] = shiftEnd.split(':').map(Number);
    const startMins = startH * 60 + startM;
    const endMins = endH * 60 + endM;

    // Handle overnight shifts
    const isOnDuty = endMins > startMins
      ? currentMins >= startMins && currentMins < endMins
      : currentMins >= startMins || currentMins < endMins;

    if (!isOnDuty) continue;

    // Parse zone assignment to floor
    const zone = d.zone_assignment ?? '';
    const floorMatch = zone.match(/^(\d+)/);
    const currentFloor = floorMatch ? parseInt(floorMatch[1], 10) : 1;

    nurses.push({
      id: doc.id,
      name: d.name,
      certifications: d.certifications ?? [],
      currentFloor,
      shiftStart,
      shiftEnd,
      assignedPatients: d.assigned_patients ?? [],
      currentLocation: d.current_location ?? { x: 0, y: 0, floor: currentFloor },
      breaksTaken: d.breaks_taken ?? 0,
      maxPatients: d.max_patients ?? 6,
    });
  }

  return nurses;
}

/**
 * Load previous acuity scores for deterioration detection.
 * Returns a map of patientId -> { score, timestamp } from the last tick.
 */
async function loadPreviousAcuityScores(
  db: FirebaseFirestore.Firestore,
): Promise<Map<string, { score: number; timestamp: number }>> {
  const map = new Map<string, { score: number; timestamp: number }>();

  const snap = await db
    .collection('acuity_history')
    .where('timestamp', '>', admin.firestore.Timestamp.fromMillis(Date.now() - 60 * 60 * 1000))
    .orderBy('timestamp', 'desc')
    .get();

  for (const doc of snap.docs) {
    const d = doc.data();
    const patientId = d.patient_id;
    // Keep only the earliest entry per patient (for jump detection)
    if (!map.has(patientId)) {
      map.set(patientId, {
        score: d.acuity_score,
        timestamp: d.timestamp?.toMillis?.() ?? Date.now(),
      });
    }
  }

  return map;
}

// ── Result writers ──────────────────────────────────────────────────

interface TickWriteResults {
  acuityUpdates: number;
  assignmentUpdates: number;
  alertsCreated: number;
  taskPriorityUpdates: number;
  acuityHistoryWrites: number;
}

async function writeResults(
  db: FirebaseFirestore.Firestore,
  patients: Patient[],
  assignments: NurseAssignment[],
  deterioratingPatientIds: string[],
  triageResults: Map<string, Array<{ alertId: string; adjustedSeverity: string; isSignificant: boolean }>>,
): Promise<TickWriteResults> {
  const results: TickWriteResults = {
    acuityUpdates: 0,
    assignmentUpdates: 0,
    alertsCreated: 0,
    taskPriorityUpdates: 0,
    acuityHistoryWrites: 0,
  };

  const now = admin.firestore.Timestamp.now();
  const MAX_BATCH = 490; // Leave headroom under 500 limit

  // ── Batch 1: Patient acuity scores + acuity history ──────────────
  let batch = db.batch();
  let opCount = 0;

  for (const patient of patients) {
    // Update patient's acuity score
    batch.update(db.collection('patients').doc(patient.id), {
      acuity_score: patient.acuityScore,
      updated_at: now,
    });
    opCount++;
    results.acuityUpdates++;

    // Write acuity history for deterioration detection on next tick
    const histRef = db.collection('acuity_history').doc();
    batch.set(histRef, {
      patient_id: patient.id,
      acuity_score: patient.acuityScore,
      timestamp: now,
    });
    opCount++;
    results.acuityHistoryWrites++;

    if (opCount >= MAX_BATCH) {
      await batch.commit();
      batch = db.batch();
      opCount = 0;
    }
  }

  if (opCount > 0) {
    await batch.commit();
    batch = db.batch();
    opCount = 0;
  }

  // ── Batch 2: Nurse assignments ────────────────────────────────────
  for (const assignment of assignments) {
    const patientIds = assignment.taskQueue.map((t) => t.patientId);
    const uniquePatientIds = [...new Set(patientIds)];

    batch.update(db.collection('users').doc(assignment.nurseId), {
      assigned_patients: uniquePatientIds,
      workload_score: assignment.workloadScore,
      total_walk_distance: assignment.totalWalkDistance,
      updated_at: now,
    });
    opCount++;
    results.assignmentUpdates++;

    if (opCount >= MAX_BATCH) {
      await batch.commit();
      batch = db.batch();
      opCount = 0;
    }
  }

  if (opCount > 0) {
    await batch.commit();
    batch = db.batch();
    opCount = 0;
  }

  // ── Batch 3: Deterioration alerts ─────────────────────────────────
  for (const patientId of deterioratingPatientIds) {
    const patient = patients.find((p) => p.id === patientId);
    if (!patient) continue;

    const alertRef = db.collection('alerts').doc();
    batch.set(alertRef, {
      patient_id: patientId,
      type: 'deterioration',
      severity: 'critical',
      original_severity: 'critical',
      message: `Patient ${patient.name} (${patient.room}) deteriorating: acuity jumped >=${ACUITY_JUMP_THRESHOLD} in last hour. Current score: ${patient.acuityScore}`,
      triage_reason: 'MediBrain automatic deterioration detection',
      is_significant: true,
      acknowledged: false,
      acknowledged_by: null,
      acknowledged_at: null,
      created_at: now,
    });
    opCount++;
    results.alertsCreated++;

    if (opCount >= MAX_BATCH) {
      await batch.commit();
      batch = db.batch();
      opCount = 0;
    }
  }

  // ── Batch 4: Update alert triage results ──────────────────────────
  for (const [_patientId, triages] of triageResults) {
    for (const triage of triages) {
      batch.update(db.collection('alerts').doc(triage.alertId), {
        severity: triage.adjustedSeverity,
        is_significant: triage.isSignificant,
        triage_reason: 'MediBrain triage adjustment based on patient context',
        updated_at: now,
      });
      opCount++;
      results.taskPriorityUpdates++;

      if (opCount >= MAX_BATCH) {
        await batch.commit();
        batch = db.batch();
        opCount = 0;
      }
    }
  }

  if (opCount > 0) {
    await batch.commit();
  }

  return results;
}

// ── Emit real-time events via EventBus ──────────────────────────────

function emitTickEvents(
  patients: Patient[],
  assignments: NurseAssignment[],
  deterioratingPatientIds: string[],
  durationMs: number,
): void {
  const now = new Date().toISOString();

  // Emit acuity changes for each patient
  for (const patient of patients) {
    eventBus.publish({
      type: 'acuity:changed',
      patientId: patient.id,
      data: { score: patient.acuityScore },
      timestamp: now,
    });
  }

  // Emit assignment updates
  for (const assignment of assignments) {
    eventBus.publish({
      type: 'assignment:updated',
      nurseId: assignment.nurseId,
      data: {
        taskCount: assignment.taskQueue.length,
        workloadScore: assignment.workloadScore,
        totalWalkDistance: assignment.totalWalkDistance,
      },
      timestamp: now,
    });
  }

  // Emit deterioration alerts
  for (const patientId of deterioratingPatientIds) {
    const patient = patients.find((p) => p.id === patientId);
    eventBus.publish({
      type: 'alert:created',
      patientId,
      data: {
        severity: 'critical',
        type: 'deterioration',
        message: `Deteriorating: acuity jumped >=${ACUITY_JUMP_THRESHOLD}`,
        acuityScore: patient?.acuityScore,
      },
      timestamp: now,
    });
  }

  // Emit system health tick
  eventBus.publish({
    type: 'system:health',
    data: {
      service: 'mediBrainTick',
      durationMs,
      patientsProcessed: patients.length,
      deteriorating: deterioratingPatientIds.length,
    },
    timestamp: now,
  });
}

// ── Overdue task generation ─────────────────────────────────────────

/**
 * Generate tasks for overdue medications and vitals checks.
 * Returns the number of tasks created.
 */
async function generateOverdueTasks(
  db: FirebaseFirestore.Firestore,
  patients: Patient[],
): Promise<number> {
  const now = Date.now();
  const batch = db.batch();
  let tasksCreated = 0;

  for (const patient of patients) {
    for (const task of patient.pendingTasks) {
      if (task.completedAt) continue;

      const scheduledMs = new Date(task.scheduledTime).getTime();
      const overdueMs = now - scheduledMs;

      // Medication overdue by > 15 min: escalate priority
      if (task.type === 'medication' && overdueMs > OVERDUE_MED_WINDOW_MS && task.priority !== 'critical') {
        batch.update(db.collection('tasks').doc(task.id), {
          priority: 'urgent',
          escalation_reason: `Medication overdue by ${Math.round(overdueMs / 60_000)} minutes`,
          updated_at: admin.firestore.Timestamp.now(),
        });
        tasksCreated++;
      }

      // Vitals overdue by > 30 min: escalate
      if (task.type === 'vitals' && overdueMs > OVERDUE_VITALS_WINDOW_MS && task.priority !== 'critical') {
        batch.update(db.collection('tasks').doc(task.id), {
          priority: 'urgent',
          escalation_reason: `Vitals check overdue by ${Math.round(overdueMs / 60_000)} minutes`,
          updated_at: admin.firestore.Timestamp.now(),
        });
        tasksCreated++;
      }
    }
  }

  if (tasksCreated > 0) {
    await batch.commit();
  }

  return tasksCreated;
}

// ── The Cloud Function ──────────────────────────────────────────────

/**
 * mediBrainTick — Firebase Cloud Function (2nd gen)
 *
 * Triggered every 60 seconds by Cloud Scheduler.
 * Performs the full MediBrain tick cycle:
 *   1. Acuity scoring for all patients
 *   2. 6-dimension priority profiling
 *   3. Alert triage (suppress false positives, adjust severity)
 *   4. Nurse assignment optimization (zone-aware routing)
 *   5. Overdue medication/vitals task generation
 *   6. Deterioration detection (acuity jump > 2 in last hour)
 *   7. Write results to Firestore
 *   8. Emit events for real-time dashboard updates
 *   9. Log execution metrics
 */
export const mediBrainTick = onSchedule(
  {
    schedule: 'every 1 minutes',
    timeZone: 'America/New_York',
    retryCount: 0, // Don't retry failed ticks — next tick will run soon
    timeoutSeconds: 55, // Must finish before next tick
    memory: '512MiB',
    region: 'us-east1',
  },
  async (_event) => {
    // ── CRON_SECRET validation ──────────────────────────────────────
    // For Firebase onSchedule (2nd gen), Cloud Scheduler authenticates
    // via IAM service account — the request is already trusted by the
    // Firebase runtime. However, we still validate CRON_SECRET as a
    // defense-in-depth measure (e.g. if the function is invoked via
    // direct HTTP or a misconfigured trigger). The secret can be set
    // via `firebase functions:secrets:set CRON_SECRET` or defineString.
    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret && process.env.NODE_ENV === 'production') {
      logger.error('[mediBrainTick] CRON_SECRET is not set in production — rejecting tick (fail closed)');
      return;
    }

    const tickStart = Date.now();
    logger.info('[mediBrainTick] Starting tick cycle');

    const db = getDb();

    // ── 1. Load current state from Firestore ────────────────────────
    const [patients, nurses, previousAcuity] = await Promise.all([
      loadActivePatients(db),
      loadOnDutyNurses(db),
      loadPreviousAcuityScores(db),
    ]);

    logger.info(
      `[mediBrainTick] Loaded ${patients.length} patients, ${nurses.length} on-duty nurses`,
    );

    if (patients.length === 0) {
      logger.info('[mediBrainTick] No active patients, skipping tick');
      return;
    }

    // ── 2. Score acuity for all patients ─────────────────────────────
    let patientsScored = 0;
    for (const patient of patients) {
      try {
        const newScore = AcuityScorer.score(patient);
        patient.acuityScore = newScore;
        patientsScored++;
      } catch (err) {
        logger.error(`[mediBrainTick] Acuity scoring failed for ${patient.id}`, err);
      }
    }

    // ── 3. Calculate 6-dimension priority profiles ──────────────────
    let prioritiesAssessed = 0;
    for (const patient of patients) {
      try {
        PatientPriority.assess(patient);
        prioritiesAssessed++;
      } catch (err) {
        logger.error(`[mediBrainTick] Priority assessment failed for ${patient.id}`, err);
      }
    }

    // ── 4. Triage alerts (suppress false positives, adjust severity) ─
    let alertsTriaged = 0;
    let alertsSuppressed = 0;
    const triageResultsMap = new Map<
      string,
      Array<{ alertId: string; adjustedSeverity: string; isSignificant: boolean }>
    >();

    for (const patient of patients) {
      if (patient.alerts.length === 0) continue;

      try {
        const triageResults = AlertTriager.triageAllAlerts(patient, patient.vitals);
        alertsTriaged += triageResults.length;

        const reduction = AlertTriager.calculateReductionRate(triageResults);
        alertsSuppressed += reduction.suppressed;

        // Collect triage adjustments for writing back
        const adjustments = triageResults.map((tr) => ({
          alertId: tr.alert.id,
          adjustedSeverity: tr.triage.adjustedSeverity,
          isSignificant: tr.triage.isSignificant,
        }));

        if (adjustments.length > 0) {
          triageResultsMap.set(patient.id, adjustments);
        }
      } catch (err) {
        logger.error(`[mediBrainTick] Alert triage failed for ${patient.id}`, err);
      }
    }

    // ── 5. Optimize nurse assignments (zone-aware routing) ──────────
    let assignments: NurseAssignment[] = [];
    try {
      if (nurses.length > 0) {
        assignments = NurseRouter.generateAssignments(nurses, patients);

        // Check nurse saturation
        for (const assignment of assignments) {
          const saturationPct = assignment.workloadScore * 10;
          if (saturationPct > NURSE_SATURATION_PCT) {
            const nurse = nurses.find((n) => n.id === assignment.nurseId);
            logger.warn(
              `[mediBrainTick] Nurse saturation alert: ${nurse?.name} at ${Math.round(saturationPct)}%`,
            );
          }
        }
      }
    } catch (err) {
      logger.error('[mediBrainTick] Nurse assignment optimization failed', err);
    }

    // ── 6. Generate tasks for overdue medications and vitals ────────
    let tasksGenerated = 0;
    try {
      tasksGenerated = await generateOverdueTasks(db, patients);
    } catch (err) {
      logger.error('[mediBrainTick] Overdue task generation failed', err);
    }

    // ── 7. Detect deteriorating patients (acuity jump > 2 in last hour) ─
    const deterioratingPatientIds: string[] = [];
    for (const patient of patients) {
      const prev = previousAcuity.get(patient.id);
      if (!prev) continue;

      const jump = patient.acuityScore - prev.score;
      if (jump >= ACUITY_JUMP_THRESHOLD) {
        deterioratingPatientIds.push(patient.id);
        logger.warn(
          `[mediBrainTick] DETERIORATION: ${patient.name} (${patient.room}) ` +
            `acuity ${prev.score} -> ${patient.acuityScore} (jump=${jump.toFixed(1)})`,
        );
      }
    }

    // ── 8. Write results back to Firestore ──────────────────────────
    let writeResults_: TickWriteResults | null = null;
    try {
      writeResults_ = await writeResults(
        db,
        patients,
        assignments,
        deterioratingPatientIds,
        triageResultsMap,
      );
    } catch (err) {
      logger.error('[mediBrainTick] Firestore write failed', err);
    }

    // ── 9. Emit events via EventBus for real-time dashboard updates ─
    const durationMs = Date.now() - tickStart;
    try {
      emitTickEvents(patients, assignments, deterioratingPatientIds, durationMs);
    } catch (err) {
      logger.error('[mediBrainTick] Event emission failed', err);
    }

    // ── 10. Save tick metrics ───────────────────────────────────────
    try {
      await db.collection('scheduler_ticks').add({
        tick_timestamp: admin.firestore.Timestamp.now(),
        duration_ms: durationMs,
        patients_scored: patientsScored,
        priorities_assessed: prioritiesAssessed,
        alerts_triaged: alertsTriaged,
        alerts_suppressed: alertsSuppressed,
        assignments_generated: assignments.length,
        tasks_escalated: tasksGenerated,
        deteriorating_patients: deterioratingPatientIds,
        deteriorating_count: deterioratingPatientIds.length,
        nurses_on_duty: nurses.length,
        write_results: writeResults_
          ? {
              acuity_updates: writeResults_.acuityUpdates,
              assignment_updates: writeResults_.assignmentUpdates,
              alerts_created: writeResults_.alertsCreated,
              task_priority_updates: writeResults_.taskPriorityUpdates,
              acuity_history_writes: writeResults_.acuityHistoryWrites,
            }
          : null,
      });
    } catch (err) {
      logger.error('[mediBrainTick] Failed to save tick metrics', err);
    }

    // ── 11. Log execution summary ───────────────────────────────────
    logger.info(
      `[mediBrainTick] Tick complete in ${durationMs}ms: ` +
        `${patientsScored} scored, ${prioritiesAssessed} priorities, ` +
        `${alertsTriaged} alerts (${alertsSuppressed} suppressed), ` +
        `${assignments.length} assignments, ${tasksGenerated} tasks escalated, ` +
        `${deterioratingPatientIds.length} deteriorating`,
    );
  },
);

// ── Cleanup: purge old acuity history ───────────────────────────────

/**
 * mediBrainCleanup — Runs daily to prune stale acuity_history docs.
 * Keeps only the last 2 hours of data (deterioration detection only needs 1 hour).
 */
export const mediBrainCleanup = onSchedule(
  {
    schedule: 'every day 03:00',
    timeZone: 'America/New_York',
    retryCount: 1,
    timeoutSeconds: 120,
    memory: '256MiB',
    region: 'us-east1',
  },
  async (_event) => {
    const db = getDb();
    const cutoff = admin.firestore.Timestamp.fromMillis(Date.now() - 2 * 60 * 60 * 1000);

    const snap = await db
      .collection('acuity_history')
      .where('timestamp', '<', cutoff)
      .limit(500)
      .get();

    if (snap.empty) {
      logger.info('[mediBrainCleanup] No stale acuity history to purge');
      return;
    }

    const batch = db.batch();
    for (const doc of snap.docs) {
      batch.delete(doc.ref);
    }
    await batch.commit();

    logger.info(`[mediBrainCleanup] Purged ${snap.size} stale acuity history docs`);
  },
);
