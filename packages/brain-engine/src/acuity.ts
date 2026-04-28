import { Patient, VitalSigns } from './types';

/**
 * AcuityScorer — Real-time patient acuity scoring.
 *
 * Uses a modified NEWS2 (National Early Warning Score 2) algorithm
 * combined with task-based workload assessment.
 *
 * Score ranges:
 * 0-2: Low acuity (stable, routine care)
 * 3-4: Medium acuity (requires monitoring)
 * 5-6: High acuity (frequent interventions)
 * 7-8: Very high acuity (continuous monitoring)
 * 9-10: Critical (1:1 nursing, ICU-level)
 *
 * In production, this would use XGBoost trained on hospital data.
 * For the prototype, we use a rule-based scoring system.
 */
export class AcuityScorer {
  /** Calculate acuity score for a patient */
  static score(patient: Patient): number {
    let score = 0;

    // 1. NEWS2 vital signs scoring (0-4 per vital, max ~20)
    const newsScore = this.calculateNEWS2(patient.vitals);

    // Map NEWS2 (0-20) to our 0-5 range for vitals component
    score += Math.min(5, newsScore / 4);

    // 2. Diagnosis complexity (0-2)
    score += this.diagnosisComplexity(patient.icdCodes);

    // 3. Pending task burden (0-2)
    score += this.taskBurden(patient.pendingTasks.length);

    // 4. Active alerts severity (0-1)
    const criticalAlerts = patient.alerts.filter(
      (a) => !a.acknowledged && (a.severity === 'critical' || a.severity === 'high')
    );
    if (criticalAlerts.length > 0) score += 1;

    return Math.min(10, Math.round(score * 10) / 10);
  }

  /** Calculate NEWS2 score from vital signs */
  static calculateNEWS2(vitals: VitalSigns): number {
    let score = 0;

    // Heart Rate scoring
    if (vitals.heartRate !== undefined) {
      const hr = vitals.heartRate;
      if (hr <= 40) score += 3;
      else if (hr <= 50) score += 1;
      else if (hr <= 90) score += 0;
      else if (hr <= 110) score += 1;
      else if (hr <= 130) score += 2;
      else score += 3;
    }

    // Systolic BP scoring
    if (vitals.systolicBP !== undefined) {
      const sbp = vitals.systolicBP;
      if (sbp <= 90) score += 3;
      else if (sbp <= 100) score += 2;
      else if (sbp <= 110) score += 1;
      else if (sbp <= 219) score += 0;
      else score += 3;
    }

    // Respiratory Rate scoring
    if (vitals.respiratoryRate !== undefined) {
      const rr = vitals.respiratoryRate;
      if (rr <= 8) score += 3;
      else if (rr <= 11) score += 1;
      else if (rr <= 20) score += 0;
      else if (rr <= 24) score += 2;
      else score += 3;
    }

    // Temperature scoring
    if (vitals.temperature !== undefined) {
      const temp = vitals.temperature;
      if (temp <= 35.0) score += 3;
      else if (temp <= 36.0) score += 1;
      else if (temp <= 38.0) score += 0;
      else if (temp <= 39.0) score += 1;
      else score += 2;
    }

    // SpO2 scoring
    if (vitals.spO2 !== undefined) {
      const spo2 = vitals.spO2;
      if (spo2 <= 91) score += 3;
      else if (spo2 <= 93) score += 2;
      else if (spo2 <= 95) score += 1;
      else score += 0;
    }

    return score;
  }

  /** Score diagnosis complexity based on ICD code count and categories */
  private static diagnosisComplexity(icdCodes: string[]): number {
    if (icdCodes.length === 0) return 0;
    if (icdCodes.length <= 2) return 0.5;
    if (icdCodes.length <= 5) return 1;
    if (icdCodes.length <= 8) return 1.5;
    return 2;
  }

  /** Score task burden based on pending task count */
  private static taskBurden(taskCount: number): number {
    if (taskCount <= 2) return 0;
    if (taskCount <= 4) return 0.5;
    if (taskCount <= 6) return 1;
    if (taskCount <= 8) return 1.5;
    return 2;
  }

  /** Detect potential sepsis using qSOFA criteria */
  static screenForSepsis(vitals: VitalSigns): {
    qsofaScore: number;
    sepsisSuspected: boolean;
  } {
    let qsofa = 0;

    // Altered mentation would be assessed clinically, not from vitals alone
    if (vitals.respiratoryRate !== undefined && vitals.respiratoryRate >= 22) qsofa += 1;
    if (vitals.systolicBP !== undefined && vitals.systolicBP <= 100) qsofa += 1;

    return {
      qsofaScore: qsofa,
      sepsisSuspected: qsofa >= 2,
    };
  }
}
