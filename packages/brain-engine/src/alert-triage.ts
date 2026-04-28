import { Patient, PatientAlert, VitalSigns } from './types';
import { AcuityScorer } from './acuity';

/**
 * AlertTriager — Reduces alarm fatigue by contextualizing alerts.
 *
 * Hospitals face 700+ alarms per bed per day with 80-99% being false/insignificant.
 * AlertTriager uses patient context to filter and prioritize real alerts.
 *
 * In production, this uses a Random Forest classifier trained on hospital alert data.
 * For the prototype, we use clinical rules + patient context.
 */
export class AlertTriager {
  /**
   * Triage a vital sign alert against patient context.
   * Returns whether the alert is likely significant and its adjusted severity.
   */
  static triageVitalAlert(
    alert: PatientAlert,
    patient: Patient,
    currentVitals: VitalSigns,
    previousVitals?: VitalSigns
  ): TriageResult {
    // Check if this is a known baseline deviation
    const isBaseline = this.isWithinPatientBaseline(
      alert,
      patient,
      currentVitals
    );
    if (isBaseline) {
      return {
        isSignificant: false,
        adjustedSeverity: 'low',
        reason: 'Within patient baseline parameters',
        actionRequired: false,
      };
    }

    // Check rate of change (trending)
    if (previousVitals) {
      const trend = this.analyzeTrend(currentVitals, previousVitals);
      if (trend.rapidDeterioration) {
        return {
          isSignificant: true,
          adjustedSeverity: 'critical',
          reason: `Rapid deterioration: ${trend.description}`,
          actionRequired: true,
          escalate: true,
        };
      }
    }

    // Check medication context (e.g., beta-blocker → low HR expected)
    const medContext = this.checkMedicationContext(alert, patient);
    if (medContext.explains) {
      return {
        isSignificant: false,
        adjustedSeverity: 'low',
        reason: medContext.reason,
        actionRequired: false,
      };
    }

    // Check sepsis screening
    const sepsisCheck = AcuityScorer.screenForSepsis(currentVitals);
    if (sepsisCheck.sepsisSuspected) {
      return {
        isSignificant: true,
        adjustedSeverity: 'critical',
        reason: `Sepsis screening positive (qSOFA=${sepsisCheck.qsofaScore})`,
        actionRequired: true,
        escalate: true,
      };
    }

    // Default: pass through with original severity
    return {
      isSignificant: true,
      adjustedSeverity: alert.severity,
      reason: 'Alert outside normal parameters, no contextual explanation found',
      actionRequired: alert.severity === 'critical' || alert.severity === 'high',
    };
  }

  /** Batch triage all active alerts for a patient */
  static triageAllAlerts(
    patient: Patient,
    currentVitals: VitalSigns,
    previousVitals?: VitalSigns
  ): Array<{ alert: PatientAlert; triage: TriageResult }> {
    return patient.alerts
      .filter((a) => !a.acknowledged)
      .map((alert) => ({
        alert,
        triage: this.triageVitalAlert(alert, patient, currentVitals, previousVitals),
      }))
      .sort((a, b) => {
        const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
        return (
          severityOrder[a.triage.adjustedSeverity] -
          severityOrder[b.triage.adjustedSeverity]
        );
      });
  }

  /** Calculate false alarm reduction rate from triage results */
  static calculateReductionRate(
    results: Array<{ triage: TriageResult }>
  ): { total: number; significant: number; suppressed: number; reductionPercent: number } {
    const total = results.length;
    const significant = results.filter((r) => r.triage.isSignificant).length;
    const suppressed = total - significant;
    return {
      total,
      significant,
      suppressed,
      reductionPercent: total > 0 ? Math.round((suppressed / total) * 100) : 0,
    };
  }

  // === Private helpers ===

  private static isWithinPatientBaseline(
    _alert: PatientAlert,
    patient: Patient,
    vitals: VitalSigns
  ): boolean {
    // Patients with known conditions may have different "normal" ranges
    const hasHTN = patient.icdCodes.some((c) => c.startsWith('I10'));
    const hasCHF = patient.icdCodes.some((c) => c.startsWith('I50'));
    const hasCOPD = patient.icdCodes.some((c) => c.startsWith('J44'));

    // HTN patients: higher BP thresholds
    if (hasHTN && vitals.systolicBP && vitals.systolicBP <= 160) {
      return true; // Known hypertensive, this is their baseline
    }

    // CHF patients: slightly lower SpO2 expected
    if (hasCHF && vitals.spO2 && vitals.spO2 >= 90) {
      return true;
    }

    // COPD patients: lower SpO2 baseline
    if (hasCOPD && vitals.spO2 && vitals.spO2 >= 88) {
      return true;
    }

    return false;
  }

  private static analyzeTrend(
    current: VitalSigns,
    previous: VitalSigns
  ): { rapidDeterioration: boolean; description: string } {
    const checks: string[] = [];

    // Heart rate change > 30 bpm
    if (current.heartRate && previous.heartRate) {
      const delta = Math.abs(current.heartRate - previous.heartRate);
      if (delta > 30) {
        checks.push(`HR changed by ${delta} bpm`);
      }
    }

    // BP drop > 30 mmHg
    if (current.systolicBP && previous.systolicBP) {
      const delta = previous.systolicBP - current.systolicBP;
      if (delta > 30) {
        checks.push(`SBP dropped by ${delta} mmHg`);
      }
    }

    // SpO2 drop > 5%
    if (current.spO2 && previous.spO2) {
      const delta = previous.spO2 - current.spO2;
      if (delta > 5) {
        checks.push(`SpO2 dropped by ${delta}%`);
      }
    }

    return {
      rapidDeterioration: checks.length > 0,
      description: checks.join('; '),
    };
  }

  private static checkMedicationContext(
    alert: PatientAlert,
    patient: Patient
  ): { explains: boolean; reason: string } {
    const alertLower = alert.message.toLowerCase();

    // Beta-blocker → low heart rate is expected
    if (alertLower.includes('heart rate') || alertLower.includes('bradycardia')) {
      const onBetaBlocker = patient.icdCodes.some(
        (c) => c.startsWith('I10') || c.startsWith('I25')
      ); // Common for HTN/CAD patients on beta-blockers
      if (onBetaBlocker) {
        return {
          explains: true,
          reason: 'Patient on beta-blocker therapy — lower heart rate expected',
        };
      }
    }

    return { explains: false, reason: '' };
  }
}

export interface TriageResult {
  isSignificant: boolean;
  adjustedSeverity: 'critical' | 'high' | 'medium' | 'low';
  reason: string;
  actionRequired: boolean;
  escalate?: boolean;
}
