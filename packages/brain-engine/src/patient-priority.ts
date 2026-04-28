import { Patient, VitalSigns, NursingTask } from './types';
import { AcuityScorer } from './acuity';

/**
 * PatientPriority — Multi-dimensional patient needs rating system.
 *
 * Unlike simple acuity scoring (single number), this produces a
 * PRIORITY PROFILE that considers:
 *
 * 1. Clinical urgency (how sick, how fast deteriorating)
 * 2. Time sensitivity (meds overdue? window closing?)
 * 3. Pain/comfort (subjective but critical for care quality)
 * 4. Fall/safety risk
 * 5. Psychosocial needs (isolation, anxiety, family absent)
 * 6. Discharge readiness (blocking a bed? needs what to go home?)
 *
 * Each dimension is scored 0-10 independently.
 * The COMPOSITE priority determines ordering in task queues.
 * But individual dimensions determine WHICH staff member responds
 * (nurse vs doctor vs social worker vs PT).
 */

export interface PriorityProfile {
  patientId: string;
  patientName: string;
  room: string;
  compositePriority: number; // 0-100, weighted combination
  dimensions: PriorityDimensions;
  primaryNeed: PriorityNeed;
  secondaryNeeds: PriorityNeed[];
  respondingRole: string; // Which role should respond first
  estimatedResponseTime: number; // minutes
  lastAssessed: string;
}

export interface PriorityDimensions {
  clinicalUrgency: DimensionScore;
  timeSensitivity: DimensionScore;
  painComfort: DimensionScore;
  safetyRisk: DimensionScore;
  psychosocial: DimensionScore;
  dischargeReadiness: DimensionScore;
}

export interface DimensionScore {
  score: number; // 0-10
  factors: string[];
  trend: 'improving' | 'stable' | 'worsening';
}

export interface PriorityNeed {
  category: 'clinical' | 'medication' | 'pain' | 'safety' | 'emotional' | 'discharge' | 'education';
  description: string;
  urgency: 'immediate' | 'within_1hr' | 'within_4hr' | 'routine';
  respondingRole: string;
}

// Dimension weights (how much each contributes to composite)
const WEIGHTS = {
  clinicalUrgency: 0.30,
  timeSensitivity: 0.25,
  painComfort: 0.15,
  safetyRisk: 0.15,
  psychosocial: 0.08,
  dischargeReadiness: 0.07,
};

export class PatientPriority {
  /** Generate a complete priority profile for a patient */
  static assess(
    patient: Patient,
    previousVitals?: VitalSigns,
    hoursAdmitted?: number
  ): PriorityProfile {
    const dimensions = this.scoreDimensions(patient, previousVitals, hoursAdmitted);

    // Composite = weighted sum * 10 (scale to 0-100)
    const composite = Math.round(
      (dimensions.clinicalUrgency.score * WEIGHTS.clinicalUrgency +
        dimensions.timeSensitivity.score * WEIGHTS.timeSensitivity +
        dimensions.painComfort.score * WEIGHTS.painComfort +
        dimensions.safetyRisk.score * WEIGHTS.safetyRisk +
        dimensions.psychosocial.score * WEIGHTS.psychosocial +
        dimensions.dischargeReadiness.score * WEIGHTS.dischargeReadiness) *
        10
    );

    // Identify primary and secondary needs
    const needs = this.identifyNeeds(patient, dimensions);
    const primaryNeed = needs[0] ?? {
      category: 'clinical' as const,
      description: 'Routine monitoring',
      urgency: 'routine' as const,
      respondingRole: 'rn_medsurg',
    };

    return {
      patientId: patient.id,
      patientName: patient.name,
      room: patient.room,
      compositePriority: Math.min(100, composite),
      dimensions,
      primaryNeed,
      secondaryNeeds: needs.slice(1),
      respondingRole: primaryNeed.respondingRole,
      estimatedResponseTime: this.estimateResponseTime(primaryNeed.urgency),
      lastAssessed: new Date().toISOString(),
    };
  }

  /** Score all 6 dimensions */
  private static scoreDimensions(
    patient: Patient,
    previousVitals?: VitalSigns,
    hoursAdmitted?: number
  ): PriorityDimensions {
    return {
      clinicalUrgency: this.scoreClinicalUrgency(patient, previousVitals),
      timeSensitivity: this.scoreTimeSensitivity(patient),
      painComfort: this.scorePainComfort(patient),
      safetyRisk: this.scoreSafetyRisk(patient, hoursAdmitted),
      psychosocial: this.scorePsychosocial(patient),
      dischargeReadiness: this.scoreDischargeReadiness(patient, hoursAdmitted),
    };
  }

  // === Dimension Scorers ===

  private static scoreClinicalUrgency(patient: Patient, previousVitals?: VitalSigns): DimensionScore {
    const factors: string[] = [];
    let score = 0;

    // NEWS2 score
    const news = AcuityScorer.calculateNEWS2(patient.vitals);
    if (news >= 7) { score += 8; factors.push(`NEWS2=${news} (critical)`); }
    else if (news >= 5) { score += 5; factors.push(`NEWS2=${news} (high)`); }
    else if (news >= 3) { score += 3; factors.push(`NEWS2=${news} (moderate)`); }
    else { score += 1; factors.push(`NEWS2=${news} (low)`); }

    // Sepsis screening
    const sepsis = AcuityScorer.screenForSepsis(patient.vitals);
    if (sepsis.sepsisSuspected) { score += 3; factors.push('Sepsis suspected (qSOFA+)'); }

    // Deterioration trend
    if (previousVitals) {
      const hrDelta = Math.abs((patient.vitals.heartRate ?? 0) - (previousVitals.heartRate ?? 0));
      const bpDelta = (previousVitals.systolicBP ?? 120) - (patient.vitals.systolicBP ?? 120);
      if (hrDelta > 20) { score += 1; factors.push(`HR trending ${hrDelta > 0 ? 'up' : 'down'}`); }
      if (bpDelta > 20) { score += 1; factors.push(`BP dropping`); }
    }

    // Unacknowledged critical alerts
    const critAlerts = patient.alerts.filter((a) => !a.acknowledged && a.severity === 'critical');
    if (critAlerts.length > 0) { score += 2; factors.push(`${critAlerts.length} critical alert(s)`); }

    const trend = previousVitals
      ? (news > AcuityScorer.calculateNEWS2(previousVitals) ? 'worsening' : news < AcuityScorer.calculateNEWS2(previousVitals) ? 'improving' : 'stable')
      : 'stable' as const;

    return { score: Math.min(10, score), factors, trend };
  }

  private static scoreTimeSensitivity(patient: Patient): DimensionScore {
    const factors: string[] = [];
    let score = 0;
    const now = Date.now();

    for (const task of patient.pendingTasks) {
      if (task.completedAt) continue;
      const scheduled = new Date(task.scheduledTime).getTime();
      const minutesUntil = (scheduled - now) / 60000;

      if (minutesUntil < -30) {
        // Overdue by 30+ min
        score += 3;
        factors.push(`OVERDUE: ${task.description} (${Math.abs(Math.round(minutesUntil))}min late)`);
      } else if (minutesUntil < 0) {
        score += 2;
        factors.push(`Overdue: ${task.description}`);
      } else if (minutesUntil < 15) {
        score += 1.5;
        factors.push(`Due soon: ${task.description} (${Math.round(minutesUntil)}min)`);
      } else if (minutesUntil < 60 && task.priority === 'critical') {
        score += 1;
        factors.push(`Critical task in ${Math.round(minutesUntil)}min`);
      }
    }

    return { score: Math.min(10, score), factors, trend: 'stable' };
  }

  private static scorePainComfort(patient: Patient): DimensionScore {
    const factors: string[] = [];
    let score = 0;
    const pain = patient.vitals.painLevel ?? 0;

    if (pain >= 8) { score = 8; factors.push(`Severe pain (${pain}/10)`); }
    else if (pain >= 5) { score = 5; factors.push(`Moderate pain (${pain}/10)`); }
    else if (pain >= 3) { score = 3; factors.push(`Mild pain (${pain}/10)`); }
    else { score = 1; factors.push(`Minimal/no pain (${pain}/10)`); }

    // Check if PRN pain medication is available but not given
    const hasPRNPain = patient.pendingTasks.some(
      (t) => t.type === 'medication' && t.description.toLowerCase().includes('prn')
    );
    if (pain >= 5 && hasPRNPain) {
      score += 1;
      factors.push('PRN pain medication available');
    }

    return { score: Math.min(10, score), factors, trend: 'stable' };
  }

  private static scoreSafetyRisk(patient: Patient, hoursAdmitted?: number): DimensionScore {
    const factors: string[] = [];
    let score = 0;

    // Age-based fall risk
    const age = 65; // Would come from patient demographics
    if (age >= 75) { score += 2; factors.push('Age >= 75 (high fall risk)'); }
    else if (age >= 65) { score += 1; factors.push('Age >= 65 (moderate fall risk)'); }

    // Medication-related risks
    const hasSedatives = patient.pendingTasks.some(
      (t) => t.description.toLowerCase().match(/morphine|fentanyl|midazolam|lorazepam/)
    );
    if (hasSedatives) { score += 2; factors.push('On sedating medications'); }

    // Isolation requirement
    if (patient.isolationRequired) { score += 1; factors.push('Isolation precautions'); }

    // Recent admission (first 24h higher risk)
    if (hoursAdmitted && hoursAdmitted < 24) {
      score += 1;
      factors.push('Admitted < 24h (orientation period)');
    }

    // Unacknowledged fall alerts
    const fallAlerts = patient.alerts.filter(
      (a) => !a.acknowledged && a.type === 'fall_risk'
    );
    if (fallAlerts.length > 0) { score += 2; factors.push('Active fall risk alert'); }

    return { score: Math.min(10, score), factors, trend: 'stable' };
  }

  private static scorePsychosocial(patient: Patient): DimensionScore {
    // Simplified — in production, this integrates with social work assessments
    const factors: string[] = [];
    let score = 2; // Baseline: most patients have some psychosocial needs

    if (patient.isolationRequired) {
      score += 2;
      factors.push('In isolation (social deprivation risk)');
    }

    // Long admission
    const admissionDays = 3; // Would calculate from admission date
    if (admissionDays > 7) {
      score += 1;
      factors.push(`Extended stay (${admissionDays} days)`);
    }

    return { score: Math.min(10, score), factors, trend: 'stable' };
  }

  private static scoreDischargeReadiness(patient: Patient, hoursAdmitted?: number): DimensionScore {
    const factors: string[] = [];
    let score = 0;

    // Low acuity + stable = closer to discharge
    if (patient.acuityScore <= 3) {
      score += 4;
      factors.push('Low acuity — potential discharge candidate');
    }

    // Check for discharge-blocking tasks
    const dischargeBlockers = patient.pendingTasks.filter(
      (t) => t.type === 'discharge' || t.type === 'education'
    );
    if (dischargeBlockers.length > 0) {
      score += 3;
      factors.push(`${dischargeBlockers.length} discharge task(s) pending`);
    }

    return { score: Math.min(10, score), factors, trend: 'stable' };
  }

  // === Need Identification ===

  private static identifyNeeds(
    patient: Patient,
    dimensions: PriorityDimensions
  ): PriorityNeed[] {
    const needs: PriorityNeed[] = [];

    if (dimensions.clinicalUrgency.score >= 7) {
      needs.push({
        category: 'clinical',
        description: dimensions.clinicalUrgency.factors.join('; '),
        urgency: 'immediate',
        respondingRole: 'attending_physician',
      });
    }

    if (dimensions.timeSensitivity.score >= 5) {
      needs.push({
        category: 'medication',
        description: dimensions.timeSensitivity.factors.join('; '),
        urgency: 'within_1hr',
        respondingRole: patient.assignedNurse ? 'rn_medsurg' : 'charge_nurse',
      });
    }

    if (dimensions.painComfort.score >= 6) {
      needs.push({
        category: 'pain',
        description: dimensions.painComfort.factors.join('; '),
        urgency: 'within_1hr',
        respondingRole: 'rn_medsurg',
      });
    }

    if (dimensions.safetyRisk.score >= 6) {
      needs.push({
        category: 'safety',
        description: dimensions.safetyRisk.factors.join('; '),
        urgency: 'within_1hr',
        respondingRole: 'cna',
      });
    }

    if (dimensions.psychosocial.score >= 6) {
      needs.push({
        category: 'emotional',
        description: dimensions.psychosocial.factors.join('; '),
        urgency: 'within_4hr',
        respondingRole: 'social_worker',
      });
    }

    if (dimensions.dischargeReadiness.score >= 5) {
      needs.push({
        category: 'discharge',
        description: dimensions.dischargeReadiness.factors.join('; '),
        urgency: 'within_4hr',
        respondingRole: 'case_manager',
      });
    }

    // Sort by urgency
    const urgencyOrder = { immediate: 0, within_1hr: 1, within_4hr: 2, routine: 3 };
    return needs.sort((a, b) => urgencyOrder[a.urgency] - urgencyOrder[b.urgency]);
  }

  private static estimateResponseTime(urgency: string): number {
    switch (urgency) {
      case 'immediate': return 2;
      case 'within_1hr': return 30;
      case 'within_4hr': return 120;
      default: return 240;
    }
  }
}
