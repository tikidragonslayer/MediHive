import { Patient, Nurse, NurseAssignment, HandoffReport } from './types';
import { AcuityScorer } from './acuity';
import { NurseRouter } from './nurse-router';
import { AlertTriager } from './alert-triage';

/**
 * MediBrain — The central AI logistics engine.
 *
 * Orchestrates:
 * 1. Real-time patient acuity scoring
 * 2. Nurse-to-patient assignment optimization
 * 3. Task routing (traveling nurse problem)
 * 4. Alert triage (reduce alarm fatigue)
 * 5. Shift handoff report generation
 * 6. Bed management predictions (future)
 */
export class MediBrain {
  private patients: Map<string, Patient> = new Map();
  private nurses: Map<string, Nurse> = new Map();
  private assignments: NurseAssignment[] = [];

  /** Load hospital state (called at shift start or on data refresh) */
  loadState(patients: Patient[], nurses: Nurse[]): void {
    this.patients.clear();
    this.nurses.clear();
    for (const p of patients) this.patients.set(p.id, p);
    for (const n of nurses) this.nurses.set(n.id, n);
  }

  /** Score all patients and sort by acuity */
  scoreAllPatients(): Array<{ patient: Patient; score: number }> {
    const results = Array.from(this.patients.values()).map((patient) => ({
      patient,
      score: AcuityScorer.score(patient),
    }));

    // Update patient acuity scores
    for (const { patient, score } of results) {
      patient.acuityScore = score;
    }

    return results.sort((a, b) => b.score - a.score);
  }

  /** Generate optimized nurse assignments */
  optimizeAssignments(): NurseAssignment[] {
    // Re-score patients first
    this.scoreAllPatients();

    const patients = Array.from(this.patients.values());
    const nurses = Array.from(this.nurses.values());

    this.assignments = NurseRouter.generateAssignments(nurses, patients);
    return this.assignments;
  }

  /** Triage all active alerts across the hospital */
  triageAlerts(): Array<{
    patientId: string;
    room: string;
    alerts: Array<{ message: string; adjustedSeverity: string; actionRequired: boolean }>;
  }> {
    const results = [];

    for (const patient of this.patients.values()) {
      if (patient.alerts.length === 0) continue;

      const triaged = AlertTriager.triageAllAlerts(patient, patient.vitals);
      const significantAlerts = triaged
        .filter((t) => t.triage.isSignificant)
        .map((t) => ({
          message: t.alert.message,
          adjustedSeverity: t.triage.adjustedSeverity,
          actionRequired: t.triage.actionRequired,
        }));

      if (significantAlerts.length > 0) {
        results.push({
          patientId: patient.id,
          room: patient.room,
          alerts: significantAlerts,
        });
      }
    }

    return results.sort((a, b) => {
      const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };
      const aMax = Math.min(
        ...a.alerts.map((al) => severityOrder[al.adjustedSeverity] ?? 3)
      );
      const bMax = Math.min(
        ...b.alerts.map((al) => severityOrder[al.adjustedSeverity] ?? 3)
      );
      return aMax - bMax;
    });
  }

  /** Generate shift handoff report for a nurse */
  generateHandoffReport(nurseId: string): HandoffReport {
    const nurse = this.nurses.get(nurseId);
    if (!nurse) throw new Error(`Nurse not found: ${nurseId}`);

    const assignedPatients = Array.from(this.patients.values()).filter(
      (p) => p.assignedNurse === nurseId
    );

    return {
      nurseId,
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
        recentChanges: this.getRecentChanges(p),
      })),
      generatedAt: new Date().toISOString(),
    };
  }

  /** Get hospital-wide dashboard metrics */
  getDashboardMetrics(): HospitalMetrics {
    const patients = Array.from(this.patients.values());
    const nurses = Array.from(this.nurses.values());

    const acuityDistribution = { low: 0, medium: 0, high: 0, critical: 0 };
    for (const p of patients) {
      if (p.acuityScore <= 3) acuityDistribution.low++;
      else if (p.acuityScore <= 5) acuityDistribution.medium++;
      else if (p.acuityScore <= 7) acuityDistribution.high++;
      else acuityDistribution.critical++;
    }

    const totalAlerts = patients.reduce((sum, p) => sum + p.alerts.length, 0);
    const unacknowledgedAlerts = patients.reduce(
      (sum, p) => sum + p.alerts.filter((a) => !a.acknowledged).length,
      0
    );

    const totalPendingTasks = patients.reduce(
      (sum, p) => sum + p.pendingTasks.filter((t) => !t.completedAt).length,
      0
    );

    const avgNurseWorkload =
      this.assignments.length > 0
        ? this.assignments.reduce((sum, a) => sum + a.workloadScore, 0) /
          this.assignments.length
        : 0;

    return {
      totalPatients: patients.length,
      totalNurses: nurses.length,
      nurseToPatientRatio: nurses.length > 0
        ? Math.round((patients.length / nurses.length) * 10) / 10
        : 0,
      acuityDistribution,
      totalAlerts,
      unacknowledgedAlerts,
      totalPendingTasks,
      avgNurseWorkload: Math.round(avgNurseWorkload * 10) / 10,
      timestamp: new Date().toISOString(),
    };
  }

  private getRecentChanges(patient: Patient): string[] {
    const changes: string[] = [];

    // Check for concerning vital trends
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

    return changes;
  }
}

interface HospitalMetrics {
  totalPatients: number;
  totalNurses: number;
  nurseToPatientRatio: number;
  acuityDistribution: { low: number; medium: number; high: number; critical: number };
  totalAlerts: number;
  unacknowledgedAlerts: number;
  totalPendingTasks: number;
  avgNurseWorkload: number;
  timestamp: string;
}
