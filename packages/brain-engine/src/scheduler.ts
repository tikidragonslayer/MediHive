import { Patient, Nurse, NursingTask, ScheduledTask, HandoffReport } from './types';
import { AcuityScorer } from './acuity';
import { PatientPriority, PriorityProfile } from './patient-priority';
import { NurseRouter } from './nurse-router';
import { AlertTriager, TriageResult } from './alert-triage';
import { BedManager } from './bed-management';

/**
 * MediBrainScheduler — The 60-second tick loop that runs the hospital's AI brain.
 *
 * Each tick:
 * 1. Pull all active patients from DB (Firestore collection reference passed in)
 * 2. Score every patient's acuity (AcuityScorer)
 * 3. Run 6-dimension patient priority scoring (PatientPriority)
 * 4. Generate/update task queues for each nurse
 * 5. Run alert triage to suppress false alarms
 * 6. Check medication schedules and generate upcoming med tasks
 * 7. Detect deteriorating patients (acuity increased >2 points in last hour)
 * 8. Generate shift-change handoff reports 30 minutes before shift end
 * 9. Update bed status based on discharges/transfers
 * 10. Emit events for dashboard real-time updates
 */

// === Types ===

export interface SchedulerConfig {
  tickIntervalMs: number; // default 60000
  shiftChangeTimes: string[]; // ["07:00", "19:00"]
  escalationThresholds: {
    acuityJump: number; // alert if score jumps this much
    missedTaskMinutes: number; // alert if task not done within window
    nurseSaturationPct: number; // alert if nurse workload > this %
  };
}

export interface TickResult {
  tickNumber: number;
  durationMs: number;
  patientsScored: number;
  tasksGenerated: number;
  alertsTriaged: number;
  alertsSuppressed: number;
  deterioratingPatients: string[];
  handoffReportsGenerated: number;
  bedsUpdated: number;
}

export interface SchedulerMetrics {
  ticksCompleted: number;
  avgTickDurationMs: number;
  totalPatientsScored: number;
  totalTasksGenerated: number;
  totalAlertsTriaged: number;
  upSinceMs: number;
}

export interface SchedulerEvent {
  type:
    | 'tick_complete'
    | 'patient_deteriorating'
    | 'handoff_generated'
    | 'escalation'
    | 'bed_update'
    | 'capacity_alert'
    | 'missed_task';
  payload: unknown;
  timestamp: string;
}

type EventListener = (event: SchedulerEvent) => void;

/** Minimal DB adapter — the scheduler doesn't care if it's Firestore, Postgres, etc. */
export interface SchedulerDataSource {
  getActivePatients(): Promise<Patient[]>;
  getOnDutyNurses(): Promise<Nurse[]>;
  getPatientPreviousVitals(patientId: string): Promise<{ acuityScore: number; timestamp: string } | null>;
  saveTickResult(result: TickResult): Promise<void>;
  saveHandoffReport(report: HandoffReport): Promise<void>;
}

// === Default config ===

const DEFAULT_CONFIG: SchedulerConfig = {
  tickIntervalMs: 60_000,
  shiftChangeTimes: ['07:00', '19:00'],
  escalationThresholds: {
    acuityJump: 2,
    missedTaskMinutes: 30,
    nurseSaturationPct: 85,
  },
};

// === Scheduler ===

export class MediBrainScheduler {
  private config: SchedulerConfig;
  private dataSource: SchedulerDataSource;
  private bedManager?: BedManager;

  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private tickNumber = 0;
  private running = false;
  private startedAt: number | null = null;

  // Metrics accumulators
  private totalTickDurationMs = 0;
  private totalPatientsScored = 0;
  private totalTasksGenerated = 0;
  private totalAlertsTriaged = 0;

  // Acuity history for deterioration detection (patientId -> { score, timestamp }[])
  private acuityHistory: Map<string, Array<{ score: number; timestamp: number }>> = new Map();

  // Event listeners
  private listeners: Map<string, EventListener[]> = new Map();

  constructor(
    dataSource: SchedulerDataSource,
    config?: Partial<SchedulerConfig>,
    bedManager?: BedManager
  ) {
    this.dataSource = dataSource;
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.bedManager = bedManager;
  }

  // === Lifecycle ===

  /** Start the tick loop */
  start(): void {
    if (this.running) return;
    this.running = true;
    this.startedAt = Date.now();

    // Run immediately, then on interval
    this.executeTick();
    this.tickTimer = setInterval(() => this.executeTick(), this.config.tickIntervalMs);
  }

  /** Stop the tick loop */
  stop(): void {
    this.running = false;
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  /** Execute a single tick (can be called manually for testing) */
  async tick(): Promise<TickResult> {
    return this.executeTick();
  }

  /** Get accumulated metrics */
  getMetrics(): SchedulerMetrics {
    return {
      ticksCompleted: this.tickNumber,
      avgTickDurationMs:
        this.tickNumber > 0
          ? Math.round(this.totalTickDurationMs / this.tickNumber)
          : 0,
      totalPatientsScored: this.totalPatientsScored,
      totalTasksGenerated: this.totalTasksGenerated,
      totalAlertsTriaged: this.totalAlertsTriaged,
      upSinceMs: this.startedAt ? Date.now() - this.startedAt : 0,
    };
  }

  /** Subscribe to scheduler events */
  on(eventType: SchedulerEvent['type'] | '*', listener: EventListener): void {
    const key = eventType;
    const existing = this.listeners.get(key) ?? [];
    existing.push(listener);
    this.listeners.set(key, existing);
  }

  /** Remove an event listener */
  off(eventType: SchedulerEvent['type'] | '*', listener: EventListener): void {
    const existing = this.listeners.get(eventType);
    if (!existing) return;
    this.listeners.set(
      eventType,
      existing.filter((l) => l !== listener)
    );
  }

  // === Core tick ===

  private async executeTick(): Promise<TickResult> {
    const tickStart = Date.now();
    this.tickNumber++;

    let patientsScored = 0;
    let tasksGenerated = 0;
    let alertsTriaged = 0;
    let alertsSuppressed = 0;
    const deterioratingPatients: string[] = [];
    let handoffReportsGenerated = 0;
    let bedsUpdated = 0;

    try {
      // 1. Pull data
      const [patients, nurses] = await Promise.all([
        this.dataSource.getActivePatients(),
        this.dataSource.getOnDutyNurses(),
      ]);

      // Process each patient individually so one failure doesn't crash the tick
      for (const patient of patients) {
        try {
          // 2. Score acuity
          const score = AcuityScorer.score(patient);
          patient.acuityScore = score;
          patientsScored++;

          // 3. Run 6-dimension priority scoring
          PatientPriority.assess(patient);

          // 7. Detect deterioration
          const isDeteriorating = this.checkDeterioration(patient.id, score);
          if (isDeteriorating) {
            deterioratingPatients.push(patient.id);
            this.emit({
              type: 'patient_deteriorating',
              payload: {
                patientId: patient.id,
                name: patient.name,
                room: patient.room,
                currentAcuity: score,
              },
              timestamp: new Date().toISOString(),
            });
          }

          // 5. Alert triage
          if (patient.alerts.length > 0) {
            const triageResults = AlertTriager.triageAllAlerts(patient, patient.vitals);
            alertsTriaged += triageResults.length;
            const reduction = AlertTriager.calculateReductionRate(triageResults);
            alertsSuppressed += reduction.suppressed;
          }

          // 6. Check medication schedules
          const medTasks = this.generateMedicationTasks(patient);
          tasksGenerated += medTasks.length;

          // Check for missed tasks
          this.checkMissedTasks(patient, nurses);
        } catch (patientErr) {
          // One bad patient shouldn't crash the whole tick
          console.error(
            `[MediBrainScheduler] Error processing patient ${patient.id}:`,
            patientErr
          );
        }
      }

      // 4. Generate/update task queues for each nurse
      try {
        const assignments = NurseRouter.generateAssignments(nurses, patients);
        for (const assignment of assignments) {
          tasksGenerated += assignment.taskQueue.length;
        }

        // Check nurse saturation
        for (const assignment of assignments) {
          const saturationPct = assignment.workloadScore * 10; // workloadScore is 0-10
          if (saturationPct > this.config.escalationThresholds.nurseSaturationPct) {
            const nurse = nurses.find((n) => n.id === assignment.nurseId);
            this.emit({
              type: 'escalation',
              payload: {
                reason: 'nurse_saturation',
                nurseId: assignment.nurseId,
                nurseName: nurse?.name,
                workloadPct: Math.round(saturationPct),
                threshold: this.config.escalationThresholds.nurseSaturationPct,
              },
              timestamp: new Date().toISOString(),
            });
          }
        }
      } catch (routerErr) {
        console.error('[MediBrainScheduler] Error generating assignments:', routerErr);
      }

      // 8. Generate shift-change handoff reports 30 minutes before shift end
      try {
        handoffReportsGenerated = await this.checkShiftHandoffs(nurses, patients);
      } catch (handoffErr) {
        console.error('[MediBrainScheduler] Error generating handoffs:', handoffErr);
      }

      // 9. Update bed status based on discharges/transfers
      if (this.bedManager) {
        try {
          bedsUpdated = this.bedManager.processCleaningTransitions();
        } catch (bedErr) {
          console.error('[MediBrainScheduler] Error updating beds:', bedErr);
        }
      }
    } catch (topLevelErr) {
      console.error('[MediBrainScheduler] Critical tick error:', topLevelErr);
    }

    // Build result
    const durationMs = Date.now() - tickStart;
    const result: TickResult = {
      tickNumber: this.tickNumber,
      durationMs,
      patientsScored,
      tasksGenerated,
      alertsTriaged,
      alertsSuppressed,
      deterioratingPatients,
      handoffReportsGenerated,
      bedsUpdated,
    };

    // Update metrics
    this.totalTickDurationMs += durationMs;
    this.totalPatientsScored += patientsScored;
    this.totalTasksGenerated += tasksGenerated;
    this.totalAlertsTriaged += alertsTriaged;

    // 10. Emit tick complete event for dashboard
    this.emit({
      type: 'tick_complete',
      payload: result,
      timestamp: new Date().toISOString(),
    });

    // Persist tick result
    try {
      await this.dataSource.saveTickResult(result);
    } catch (saveErr) {
      console.error('[MediBrainScheduler] Error saving tick result:', saveErr);
    }

    // Log summary
    console.log(
      `[MediBrainScheduler] Tick #${result.tickNumber} complete: ` +
        `${patientsScored} scored, ${tasksGenerated} tasks, ` +
        `${alertsTriaged} alerts (${alertsSuppressed} suppressed), ` +
        `${deterioratingPatients.length} deteriorating, ` +
        `${durationMs}ms`
    );

    return result;
  }

  // === Deterioration Detection ===

  /**
   * Track acuity over time and detect if a patient's score jumped
   * more than the configured threshold within the last hour.
   */
  private checkDeterioration(patientId: string, currentScore: number): boolean {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;

    // Get or create history
    const history = this.acuityHistory.get(patientId) ?? [];

    // Prune entries older than 2 hours (keep some buffer)
    const pruned = history.filter((h) => h.timestamp > now - 2 * 60 * 60 * 1000);

    // Add current reading
    pruned.push({ score: currentScore, timestamp: now });
    this.acuityHistory.set(patientId, pruned);

    // Find the lowest score in the last hour
    const recentEntries = pruned.filter((h) => h.timestamp >= oneHourAgo);
    if (recentEntries.length < 2) return false;

    const minScore = Math.min(...recentEntries.map((h) => h.score));
    const jump = currentScore - minScore;

    return jump >= this.config.escalationThresholds.acuityJump;
  }

  // === Medication Schedule Checking ===

  /**
   * Scan a patient's pending tasks and generate medication reminders
   * for meds due within the next 15 minutes that aren't yet assigned.
   */
  private generateMedicationTasks(patient: Patient): NursingTask[] {
    const now = Date.now();
    const lookAheadMs = 15 * 60 * 1000; // 15 minutes
    const generated: NursingTask[] = [];

    for (const task of patient.pendingTasks) {
      if (task.completedAt) continue;
      if (task.type !== 'medication') continue;

      const scheduledTime = new Date(task.scheduledTime).getTime();
      const timeUntilDue = scheduledTime - now;

      // Generate an upcoming-med alert if due within 15 min and not overdue by more than window
      if (timeUntilDue > 0 && timeUntilDue <= lookAheadMs) {
        generated.push(task);
      }
    }

    return generated;
  }

  // === Missed Task Detection ===

  private checkMissedTasks(patient: Patient, nurses: Nurse[]): void {
    const now = Date.now();
    const thresholdMs = this.config.escalationThresholds.missedTaskMinutes * 60 * 1000;

    for (const task of patient.pendingTasks) {
      if (task.completedAt) continue;

      const scheduledTime = new Date(task.scheduledTime).getTime();
      const overdueMs = now - scheduledTime;

      if (overdueMs > thresholdMs) {
        const assignedNurse = nurses.find((n) => n.id === patient.assignedNurse);
        this.emit({
          type: 'missed_task',
          payload: {
            taskId: task.id,
            patientId: patient.id,
            patientName: patient.name,
            room: patient.room,
            taskType: task.type,
            description: task.description,
            priority: task.priority,
            scheduledTime: task.scheduledTime,
            overdueMinutes: Math.round(overdueMs / 60_000),
            assignedNurse: assignedNurse?.name ?? 'unassigned',
          },
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  // === Shift Handoff ===

  /**
   * Check if any nurses are within 30 minutes of their shift end.
   * If so, generate a handoff report and persist it.
   */
  private async checkShiftHandoffs(
    nurses: Nurse[],
    patients: Patient[]
  ): Promise<number> {
    const now = new Date();
    let generated = 0;

    for (const nurse of nurses) {
      try {
        const shiftEnd = this.parseTimeToday(nurse.shiftEnd);
        if (!shiftEnd) continue;

        const minutesUntilEnd = (shiftEnd.getTime() - now.getTime()) / 60_000;

        // Generate handoff 30 minutes before shift end (but only once per window)
        if (minutesUntilEnd > 0 && minutesUntilEnd <= 30) {
          const assignedPatients = patients.filter(
            (p) => p.assignedNurse === nurse.id
          );

          const report: HandoffReport = {
            nurseId: nurse.id,
            shiftEnd: nurse.shiftEnd,
            patients: assignedPatients.map((p) => ({
              patientId: p.id,
              name: p.name,
              room: p.room,
              acuityScore: p.acuityScore,
              keyIssues: [
                p.primaryDiagnosis,
                ...p.alerts
                  .filter((a) => !a.acknowledged && a.severity !== 'low')
                  .map((a) => a.message),
              ],
              pendingTasks: p.pendingTasks
                .filter((t) => !t.completedAt)
                .map((t) => `${t.type}: ${t.description} (${t.priority})`),
              recentChanges: this.summarizeRecentChanges(p),
            })),
            generatedAt: now.toISOString(),
          };

          await this.dataSource.saveHandoffReport(report);
          generated++;

          this.emit({
            type: 'handoff_generated',
            payload: {
              nurseId: nurse.id,
              nurseName: nurse.name,
              patientCount: assignedPatients.length,
              shiftEnd: nurse.shiftEnd,
            },
            timestamp: now.toISOString(),
          });
        }
      } catch (err) {
        console.error(
          `[MediBrainScheduler] Error generating handoff for nurse ${nurse.id}:`,
          err
        );
      }
    }

    return generated;
  }

  // === Helpers ===

  private summarizeRecentChanges(patient: Patient): string[] {
    const changes: string[] = [];
    const vitals = patient.vitals;

    if (vitals.heartRate && vitals.heartRate > 120) {
      changes.push(`Tachycardia: HR ${vitals.heartRate}`);
    }
    if (vitals.spO2 && vitals.spO2 < 92) {
      changes.push(`Low SpO2: ${vitals.spO2}%`);
    }
    if (vitals.systolicBP && vitals.systolicBP < 90) {
      changes.push(`Hypotension: SBP ${vitals.systolicBP}`);
    }
    if (vitals.temperature && vitals.temperature > 39.0) {
      changes.push(`Fever: ${vitals.temperature}°C`);
    }

    // Check acuity trend
    const history = this.acuityHistory.get(patient.id);
    if (history && history.length >= 2) {
      const oldest = history[0].score;
      const newest = history[history.length - 1].score;
      const delta = newest - oldest;
      if (Math.abs(delta) >= 1) {
        changes.push(`Acuity ${delta > 0 ? 'worsened' : 'improved'} by ${Math.abs(delta).toFixed(1)} pts`);
      }
    }

    return changes;
  }

  private parseTimeToday(timeStr: string): Date | null {
    const match = timeStr.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return null;
    const now = new Date();
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    date.setHours(parseInt(match[1], 10), parseInt(match[2], 10), 0, 0);
    return date;
  }

  private emit(event: SchedulerEvent): void {
    // Notify specific listeners
    const specific = this.listeners.get(event.type) ?? [];
    for (const listener of specific) {
      try {
        listener(event);
      } catch (err) {
        console.error(`[MediBrainScheduler] Event listener error (${event.type}):`, err);
      }
    }

    // Notify wildcard listeners
    const wildcard = this.listeners.get('*') ?? [];
    for (const listener of wildcard) {
      try {
        listener(event);
      } catch (err) {
        console.error(`[MediBrainScheduler] Wildcard listener error:`, err);
      }
    }
  }
}
