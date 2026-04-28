/**
 * MedicationChecker — Drug-drug interaction detection and verification.
 *
 * Used by:
 * - Pharmacy portal (before dispensing)
 * - Nurse portal (BCMA — barcode medication administration)
 * - Doctor portal (when prescribing)
 * - MediScribe (when extracting medication entities from transcripts)
 *
 * In production: connects to NLM RxNorm API + DailyMed for real interactions.
 * For prototype: uses a curated interaction database of common critical combinations.
 */

export interface DrugInteraction {
  drug1: string;
  drug2: string;
  severity: 'critical' | 'major' | 'moderate' | 'minor';
  effect: string;
  recommendation: string;
}

export interface InteractionCheckResult {
  medications: string[];
  interactions: DrugInteraction[];
  hasCritical: boolean;
  hasMajor: boolean;
  summary: string;
}

export interface BCMAVerification {
  patientId: string;
  medicationScanned: string;
  orderedMedication: string;
  doseMatch: boolean;
  routeMatch: boolean;
  timeWindowOk: boolean;
  interactionsClear: boolean;
  verified: boolean;
  warnings: string[];
}

// Common critical drug interactions database
const INTERACTION_DB: DrugInteraction[] = [
  { drug1: 'warfarin', drug2: 'aspirin', severity: 'major', effect: 'Increased bleeding risk', recommendation: 'Monitor INR closely; consider PPI for GI protection' },
  { drug1: 'warfarin', drug2: 'ibuprofen', severity: 'major', effect: 'Increased bleeding risk + GI ulceration', recommendation: 'Avoid combination; use acetaminophen instead' },
  { drug1: 'metformin', drug2: 'contrast dye', severity: 'critical', effect: 'Lactic acidosis risk', recommendation: 'Hold metformin 48h before and after contrast' },
  { drug1: 'lisinopril', drug2: 'potassium', severity: 'major', effect: 'Hyperkalemia risk', recommendation: 'Monitor serum potassium; reduce supplementation' },
  { drug1: 'lisinopril', drug2: 'spironolactone', severity: 'major', effect: 'Severe hyperkalemia', recommendation: 'Monitor K+ within 3 days; consider alternative' },
  { drug1: 'metoprolol', drug2: 'verapamil', severity: 'critical', effect: 'Severe bradycardia, heart block, cardiac arrest', recommendation: 'AVOID combination; use alternative antihypertensive' },
  { drug1: 'metoprolol', drug2: 'diltiazem', severity: 'major', effect: 'Bradycardia and hypotension', recommendation: 'If necessary, start low dose with ECG monitoring' },
  { drug1: 'ssri', drug2: 'maoi', severity: 'critical', effect: 'Serotonin syndrome — potentially fatal', recommendation: 'CONTRAINDICATED; 14-day washout required between' },
  { drug1: 'sertraline', drug2: 'tramadol', severity: 'major', effect: 'Serotonin syndrome risk', recommendation: 'Avoid; use non-serotonergic pain management' },
  { drug1: 'ciprofloxacin', drug2: 'theophylline', severity: 'critical', effect: 'Theophylline toxicity (seizures)', recommendation: 'Reduce theophylline dose 50%; monitor levels' },
  { drug1: 'simvastatin', drug2: 'amiodarone', severity: 'major', effect: 'Rhabdomyolysis risk', recommendation: 'Limit simvastatin to 20mg/day; consider pravastatin' },
  { drug1: 'clopidogrel', drug2: 'omeprazole', severity: 'major', effect: 'Reduced antiplatelet efficacy', recommendation: 'Switch to pantoprazole (does not inhibit CYP2C19)' },
  { drug1: 'insulin', drug2: 'sulfonylurea', severity: 'moderate', effect: 'Hypoglycemia risk', recommendation: 'Monitor blood glucose; reduce sulfonylurea dose' },
  { drug1: 'furosemide', drug2: 'gentamicin', severity: 'major', effect: 'Ototoxicity and nephrotoxicity', recommendation: 'Monitor renal function and hearing; avoid if possible' },
  { drug1: 'lithium', drug2: 'ibuprofen', severity: 'major', effect: 'Lithium toxicity', recommendation: 'Monitor lithium levels; reduce dose or avoid NSAIDs' },
  { drug1: 'digoxin', drug2: 'amiodarone', severity: 'critical', effect: 'Digoxin toxicity (fatal arrhythmias)', recommendation: 'Reduce digoxin dose 50%; monitor levels' },
  { drug1: 'morphine', drug2: 'benzodiazepine', severity: 'critical', effect: 'Respiratory depression — potentially fatal', recommendation: 'FDA black box warning; avoid unless no alternative' },
  { drug1: 'fentanyl', drug2: 'benzodiazepine', severity: 'critical', effect: 'Respiratory depression — potentially fatal', recommendation: 'FDA black box warning; avoid unless no alternative' },
];

// Drug class mapping for fuzzy matching
const DRUG_CLASSES: Record<string, string[]> = {
  ssri: ['sertraline', 'fluoxetine', 'paroxetine', 'citalopram', 'escitalopram', 'fluvoxamine'],
  maoi: ['phenelzine', 'tranylcypromine', 'isocarboxazid', 'selegiline'],
  benzodiazepine: ['diazepam', 'lorazepam', 'alprazolam', 'midazolam', 'clonazepam'],
  sulfonylurea: ['glipizide', 'glyburide', 'glimepiride'],
  nsaid: ['ibuprofen', 'naproxen', 'indomethacin', 'ketorolac', 'celecoxib'],
};

export class MedicationChecker {
  /** Check all pairwise interactions in a medication list */
  static checkInteractions(medications: string[]): InteractionCheckResult {
    const normalized = medications.map((m) => m.toLowerCase().trim());
    const found: DrugInteraction[] = [];

    for (let i = 0; i < normalized.length; i++) {
      for (let j = i + 1; j < normalized.length; j++) {
        const interactions = this.findInteraction(normalized[i], normalized[j]);
        found.push(...interactions);
      }
    }

    // Deduplicate
    const unique = found.filter(
      (f, idx) => found.findIndex((o) => o.drug1 === f.drug1 && o.drug2 === f.drug2 && o.effect === f.effect) === idx
    );

    const hasCritical = unique.some((i) => i.severity === 'critical');
    const hasMajor = unique.some((i) => i.severity === 'major');

    let summary = `${unique.length} interaction(s) found`;
    if (hasCritical) summary += ' — CRITICAL INTERACTIONS DETECTED';
    else if (hasMajor) summary += ' — major interactions detected';
    else if (unique.length === 0) summary = 'No known interactions';

    return { medications, interactions: unique, hasCritical, hasMajor, summary };
  }

  /** BCMA (Barcode Medication Administration) verification */
  static verifyBCMA(params: {
    patientId: string;
    scannedBarcode: string;
    orderedMedication: string;
    orderedDose: string;
    orderedRoute: string;
    scheduledTime: string;
    currentMedications: string[];
  }): BCMAVerification {
    const warnings: string[] = [];
    const scannedMed = params.scannedBarcode.toLowerCase();
    const orderedMed = params.orderedMedication.toLowerCase();

    // 5 Rights of Medication Administration
    // Right Patient — verified by scanning patient wristband (external)
    // Right Medication
    const doseMatch = scannedMed.includes(orderedMed) || orderedMed.includes(scannedMed);
    if (!doseMatch) warnings.push(`WRONG MEDICATION: Scanned "${params.scannedBarcode}" does not match ordered "${params.orderedMedication}"`);

    // Right Dose — would compare barcode dose vs order (simplified here)
    const doseMatchResult = true; // Barcode would encode dose

    // Right Route — would verify from barcode metadata
    const routeMatch = true;

    // Right Time
    const scheduled = new Date(params.scheduledTime).getTime();
    const now = Date.now();
    const windowMs = 60 * 60 * 1000; // 1 hour window
    const timeWindowOk = Math.abs(now - scheduled) <= windowMs;
    if (!timeWindowOk) warnings.push(`OUTSIDE TIME WINDOW: Scheduled ${params.scheduledTime}, current time exceeds 1-hour window`);

    // Interaction check against current meds
    const interactionResult = this.checkInteractions([
      params.orderedMedication,
      ...params.currentMedications,
    ]);
    const interactionsClear = !interactionResult.hasCritical;
    if (interactionResult.hasCritical) {
      warnings.push(`CRITICAL INTERACTION: ${interactionResult.interactions.filter((i) => i.severity === 'critical').map((i) => i.effect).join('; ')}`);
    }

    const verified = doseMatch && doseMatchResult && routeMatch && timeWindowOk && interactionsClear;

    return {
      patientId: params.patientId,
      medicationScanned: params.scannedBarcode,
      orderedMedication: params.orderedMedication,
      doseMatch: doseMatchResult,
      routeMatch,
      timeWindowOk,
      interactionsClear,
      verified,
      warnings,
    };
  }

  /** Find interactions between two specific drugs (with class expansion) */
  private static findInteraction(drug1: string, drug2: string): DrugInteraction[] {
    const results: DrugInteraction[] = [];

    // Expand drug classes
    const drugs1 = this.expandDrugClass(drug1);
    const drugs2 = this.expandDrugClass(drug2);

    for (const d1 of drugs1) {
      for (const d2 of drugs2) {
        for (const interaction of INTERACTION_DB) {
          if (
            (interaction.drug1 === d1 && interaction.drug2 === d2) ||
            (interaction.drug1 === d2 && interaction.drug2 === d1)
          ) {
            results.push({
              ...interaction,
              drug1: drug1, // Use original names for clarity
              drug2: drug2,
            });
          }
        }
      }
    }

    return results;
  }

  /** Expand a drug name to include its class if applicable */
  private static expandDrugClass(drug: string): string[] {
    const results = [drug];
    for (const [className, members] of Object.entries(DRUG_CLASSES)) {
      if (members.includes(drug)) {
        results.push(className);
      }
    }
    return results;
  }
}
