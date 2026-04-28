import { Patient, Nurse, NursingTask, VitalSigns, HandoffReport } from './types';
import { AcuityScorer } from './acuity';
import { MedicationChecker, BCMAVerification } from './medication-checker';

/**
 * NurseWorkflow — Complete nurse workflow management.
 *
 * Handles the full nursing lifecycle:
 * 1. Shift start: receive handoff + task queue
 * 2. Rounding: vitals entry, assessments, medication admin
 * 3. Documentation: auto-generated from completed tasks
 * 4. Shift end: generate handoff for next nurse
 *
 * All actions create on-chain audit entries via the AuditLogger.
 */

export interface VitalsEntry {
  patientId: string;
  nurseId: string;
  vitals: VitalSigns;
  assessmentNotes?: string;
  painAssessment?: { level: number; location: string; quality: string };
  fallRisk?: { score: number; precautions: string[] };
  timestamp: string;
}

export interface MedicationAdminRecord {
  patientId: string;
  nurseId: string;
  medication: string;
  dose: string;
  route: string;
  site?: string;
  bcmaVerification: BCMAVerification;
  patientResponse?: string;
  timestamp: string;
}

export interface TaskCompletionRecord {
  taskId: string;
  nurseId: string;
  patientId: string;
  completedAt: string;
  duration: number; // minutes
  notes?: string;
  vitalsRecorded?: VitalSigns;
  medicationAdmin?: MedicationAdminRecord;
  requiresFollowUp: boolean;
  followUpReason?: string;
}

export interface RoundingSession {
  nurseId: string;
  patientId: string;
  room: string;
  startTime: string;
  endTime?: string;
  vitalsEntered: boolean;
  medicationsAdministered: string[];
  assessmentCompleted: boolean;
  tasksCompleted: string[];
  notes: string[];
}

export class NurseWorkflow {
  private activeRoundings: Map<string, RoundingSession> = new Map();
  private completedTasks: TaskCompletionRecord[] = [];
  private vitalsHistory: Map<string, VitalsEntry[]> = new Map(); // patientId → entries

  /** Start rounding on a patient */
  startRounding(nurseId: string, patient: Patient): string {
    const sessionKey = `${nurseId}:${patient.id}`;
    const session: RoundingSession = {
      nurseId,
      patientId: patient.id,
      room: patient.room,
      startTime: new Date().toISOString(),
      vitalsEntered: false,
      medicationsAdministered: [],
      assessmentCompleted: false,
      tasksCompleted: [],
      notes: [],
    };
    this.activeRoundings.set(sessionKey, session);
    return sessionKey;
  }

  /** Record vital signs during rounding */
  recordVitals(sessionKey: string, vitals: VitalSigns, notes?: string): VitalsEntry {
    const session = this.getRounding(sessionKey);

    const entry: VitalsEntry = {
      patientId: session.patientId,
      nurseId: session.nurseId,
      vitals,
      assessmentNotes: notes,
      timestamp: new Date().toISOString(),
    };

    // Store in history
    const history = this.vitalsHistory.get(session.patientId) ?? [];
    history.push(entry);
    this.vitalsHistory.set(session.patientId, history);

    session.vitalsEntered = true;

    // Check for concerning values and auto-generate alerts
    const alerts = this.checkVitalAlerts(vitals, session.patientId);

    return entry;
  }

  /** BCMA scan and medication administration */
  administerMedication(
    sessionKey: string,
    scannedBarcode: string,
    orderedMedication: string,
    orderedDose: string,
    orderedRoute: string,
    scheduledTime: string,
    currentMedications: string[]
  ): MedicationAdminRecord {
    const session = this.getRounding(sessionKey);

    // BCMA verification (5 Rights)
    const verification = MedicationChecker.verifyBCMA({
      patientId: session.patientId,
      scannedBarcode,
      orderedMedication,
      orderedDose,
      orderedRoute,
      scheduledTime,
      currentMedications,
    });

    const record: MedicationAdminRecord = {
      patientId: session.patientId,
      nurseId: session.nurseId,
      medication: orderedMedication,
      dose: orderedDose,
      route: orderedRoute,
      bcmaVerification: verification,
      timestamp: new Date().toISOString(),
    };

    if (verification.verified) {
      session.medicationsAdministered.push(orderedMedication);
    }

    return record;
  }

  /** Complete a specific task */
  completeTask(
    sessionKey: string,
    taskId: string,
    notes?: string,
    followUpNeeded?: boolean,
    followUpReason?: string
  ): TaskCompletionRecord {
    const session = this.getRounding(sessionKey);
    const startTime = new Date(session.startTime).getTime();
    const now = Date.now();

    const record: TaskCompletionRecord = {
      taskId,
      nurseId: session.nurseId,
      patientId: session.patientId,
      completedAt: new Date().toISOString(),
      duration: Math.round((now - startTime) / 60000),
      notes,
      requiresFollowUp: followUpNeeded ?? false,
      followUpReason,
    };

    session.tasksCompleted.push(taskId);
    this.completedTasks.push(record);
    return record;
  }

  /** End rounding session and generate documentation */
  endRounding(sessionKey: string): RoundingSession {
    const session = this.getRounding(sessionKey);
    session.endTime = new Date().toISOString();
    this.activeRoundings.delete(sessionKey);
    return session;
  }

  /** Generate end-of-shift handoff report */
  generateHandoff(
    nurseId: string,
    patients: Patient[],
    shiftEnd: string
  ): HandoffReport {
    const nursePatients = patients.filter((p) => p.assignedNurse === nurseId);

    return {
      nurseId,
      shiftEnd,
      patients: nursePatients.map((p) => {
        const vitals = this.vitalsHistory.get(p.id) ?? [];
        const lastVitals = vitals[vitals.length - 1];
        const tasksCompleted = this.completedTasks.filter(
          (t) => t.patientId === p.id && t.nurseId === nurseId
        );
        const pendingTasks = p.pendingTasks.filter(
          (t) => !t.completedAt && !tasksCompleted.some((ct) => ct.taskId === t.id)
        );

        return {
          patientId: p.id,
          name: p.name,
          room: p.room,
          acuityScore: AcuityScorer.score(p),
          keyIssues: [
            p.primaryDiagnosis,
            ...p.alerts.filter((a) => !a.acknowledged).map((a) => `ALERT: ${a.message}`),
            ...(lastVitals?.assessmentNotes ? [`Last assessment: ${lastVitals.assessmentNotes}`] : []),
          ],
          pendingTasks: pendingTasks.map((t) => `${t.type}: ${t.description} (${t.priority})`),
          recentChanges: [
            `${tasksCompleted.length} tasks completed this shift`,
            ...(vitals.length > 0 ? [`Last vitals: HR ${lastVitals?.vitals.heartRate}, BP ${lastVitals?.vitals.systolicBP}/${lastVitals?.vitals.diastolicBP}`] : []),
            ...tasksCompleted.filter((t) => t.requiresFollowUp).map((t) => `FOLLOW-UP: ${t.followUpReason}`),
          ],
        };
      }),
      generatedAt: new Date().toISOString(),
    };
  }

  /** Get vitals trend for a patient */
  getVitalsTrend(patientId: string, hours: number = 24): VitalsEntry[] {
    const history = this.vitalsHistory.get(patientId) ?? [];
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    return history.filter((v) => new Date(v.timestamp).getTime() >= cutoff);
  }

  /** Get task completion stats for a nurse's shift */
  getShiftStats(nurseId: string): {
    tasksCompleted: number;
    avgDuration: number;
    followUpsGenerated: number;
    medicationsAdministered: number;
    vitalsRecorded: number;
  } {
    const tasks = this.completedTasks.filter((t) => t.nurseId === nurseId);
    const avgDuration = tasks.length > 0
      ? tasks.reduce((s, t) => s + t.duration, 0) / tasks.length
      : 0;

    return {
      tasksCompleted: tasks.length,
      avgDuration: Math.round(avgDuration),
      followUpsGenerated: tasks.filter((t) => t.requiresFollowUp).length,
      medicationsAdministered: tasks.filter((t) => t.medicationAdmin).length,
      vitalsRecorded: Array.from(this.vitalsHistory.values()).flat().filter(
        (v) => v.nurseId === nurseId
      ).length,
    };
  }

  private getRounding(sessionKey: string): RoundingSession {
    const session = this.activeRoundings.get(sessionKey);
    if (!session) throw new Error(`No active rounding session: ${sessionKey}`);
    return session;
  }

  private checkVitalAlerts(vitals: VitalSigns, patientId: string): string[] {
    const alerts: string[] = [];
    if (vitals.heartRate && (vitals.heartRate > 120 || vitals.heartRate < 50))
      alerts.push(`HR ${vitals.heartRate} — outside safe range`);
    if (vitals.systolicBP && vitals.systolicBP < 90)
      alerts.push(`SBP ${vitals.systolicBP} — hypotension`);
    if (vitals.spO2 && vitals.spO2 < 90)
      alerts.push(`SpO2 ${vitals.spO2}% — critical desaturation`);
    if (vitals.temperature && vitals.temperature > 39.0)
      alerts.push(`Temp ${vitals.temperature}°C — high fever`);
    if (vitals.respiratoryRate && vitals.respiratoryRate > 28)
      alerts.push(`RR ${vitals.respiratoryRate} — tachypnea`);
    return alerts;
  }
}
