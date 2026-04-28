/**
 * Medi-Hive Firestore Seed Script
 *
 * Seeds realistic hospital data for grant demo:
 *   40 patients, 20 staff, 120 beds, 1920 vitals, 80 tasks, 20 alerts, 10 appointments
 *
 * Usage:
 *   npx tsx seed/seed-firestore.ts                         # production project
 *   FIRESTORE_EMULATOR_HOST=localhost:8080 npx tsx seed/seed-firestore.ts  # emulator
 */

import * as admin from 'firebase-admin';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';

// ── Firebase Init ───────────────────────────────────────────────────────

const PROJECT_ID = 'medihive-demo';

if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.log(`[seed] Using Firestore emulator at ${process.env.FIRESTORE_EMULATOR_HOST}`);
  admin.initializeApp({ projectId: PROJECT_ID });
} else {
  console.log(`[seed] Connecting to production Firestore (project: ${PROJECT_ID})`);
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: PROJECT_ID,
  });
}

const db = admin.firestore();
db.settings({ ignoreUndefinedProperties: true });

// ── Helpers ─────────────────────────────────────────────────────────────

function ts(date: Date): Timestamp {
  return Timestamp.fromDate(date);
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(0, 0, 0, 0);
  return d;
}

function hoursAgo(n: number): Date {
  return new Date(Date.now() - n * 3600_000);
}

function rand(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function randInt(min: number, max: number): number {
  return Math.floor(rand(min, max + 1));
}

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

/** Commit a batch of writes, respecting the 500-op limit. */
async function batchWrite(
  ops: Array<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }>,
): Promise<void> {
  for (let i = 0; i < ops.length; i += 450) {
    const chunk = ops.slice(i, i + 450);
    const batch = db.batch();
    for (const op of chunk) {
      batch.set(op.ref, op.data);
    }
    await batch.commit();
  }
}

// ── Reference Data ──────────────────────────────────────────────────────

const FLOORS = [2, 3, 4, 5] as const;
const WINGS = ['East', 'West'] as const;

const FIRST_NAMES = [
  'Alice', 'Robert', 'Maria', 'James', 'Patricia', 'David', 'Linda', 'Michael',
  'Barbara', 'William', 'Elizabeth', 'Richard', 'Jennifer', 'Joseph', 'Susan',
  'Thomas', 'Jessica', 'Charles', 'Sarah', 'Christopher', 'Karen', 'Daniel',
  'Lisa', 'Matthew', 'Nancy', 'Anthony', 'Betty', 'Mark', 'Margaret', 'Donald',
  'Sandra', 'Steven', 'Ashley', 'Paul', 'Dorothy', 'Andrew', 'Kimberly', 'Joshua',
  'Donna', 'Kenneth',
];

const LAST_NAMES = [
  'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis',
  'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson',
  'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin', 'Lee', 'Perez', 'Thompson',
  'White', 'Harris', 'Sanchez', 'Clark', 'Ramirez', 'Lewis', 'Robinson',
  'Walker', 'Young', 'Allen', 'King', 'Wright', 'Scott', 'Torres', 'Nguyen',
  'Hill', 'Flores',
];

// ── Patient diagnosis catalog ───────────────────────────────────────────

interface DiagnosisEntry {
  name: string;
  icd10: string[];
  acuityRange: [number, number];
  tier: 'critical' | 'high' | 'medium' | 'low';
  baseMeds: Array<{ name: string; dose: string; route: string; frequency: string }>;
}

const DIAGNOSES: DiagnosisEntry[] = [
  // CRITICAL (acuity 8-10)
  {
    name: 'Sepsis with septic shock',
    icd10: ['A41.9', 'R65.21'],
    acuityRange: [9, 10],
    tier: 'critical',
    baseMeds: [
      { name: 'Norepinephrine', dose: '0.1 mcg/kg/min', route: 'IV', frequency: 'continuous' },
      { name: 'Piperacillin-Tazobactam', dose: '4.5 g', route: 'IV', frequency: 'q6h' },
      { name: 'Vancomycin', dose: '1.5 g', route: 'IV', frequency: 'q12h' },
      { name: 'Normal Saline', dose: '250 mL/hr', route: 'IV', frequency: 'continuous' },
    ],
  },
  {
    name: 'Acute ST-elevation myocardial infarction',
    icd10: ['I21.3'],
    acuityRange: [8, 10],
    tier: 'critical',
    baseMeds: [
      { name: 'Heparin', dose: '18 units/kg/hr', route: 'IV', frequency: 'continuous' },
      { name: 'Aspirin', dose: '325 mg', route: 'PO', frequency: 'daily' },
      { name: 'Clopidogrel', dose: '75 mg', route: 'PO', frequency: 'daily' },
      { name: 'Metoprolol', dose: '25 mg', route: 'IV', frequency: 'q6h' },
      { name: 'Nitroglycerin', dose: '5 mcg/min', route: 'IV', frequency: 'continuous' },
    ],
  },
  {
    name: 'Acute hypoxic respiratory failure',
    icd10: ['J96.01'],
    acuityRange: [8, 10],
    tier: 'critical',
    baseMeds: [
      { name: 'Dexmedetomidine', dose: '0.5 mcg/kg/hr', route: 'IV', frequency: 'continuous' },
      { name: 'Ceftriaxone', dose: '2 g', route: 'IV', frequency: 'q24h' },
      { name: 'Azithromycin', dose: '500 mg', route: 'IV', frequency: 'daily' },
      { name: 'Albuterol', dose: '2.5 mg', route: 'NEB', frequency: 'q4h PRN' },
    ],
  },
  {
    name: 'Diabetic ketoacidosis crisis',
    icd10: ['E11.10', 'E87.2'],
    acuityRange: [8, 10],
    tier: 'critical',
    baseMeds: [
      { name: 'Insulin Regular', dose: '0.1 units/kg/hr', route: 'IV', frequency: 'continuous' },
      { name: 'Potassium Chloride', dose: '20 mEq', route: 'IV', frequency: 'q2h' },
      { name: 'Normal Saline', dose: '500 mL/hr', route: 'IV', frequency: 'continuous' },
    ],
  },

  // HIGH (acuity 6-7)
  {
    name: 'Acute ischemic stroke',
    icd10: ['I63.9'],
    acuityRange: [6, 7],
    tier: 'high',
    baseMeds: [
      { name: 'Alteplase', dose: '0.9 mg/kg', route: 'IV', frequency: 'once' },
      { name: 'Aspirin', dose: '325 mg', route: 'PO', frequency: 'daily' },
      { name: 'Atorvastatin', dose: '80 mg', route: 'PO', frequency: 'daily' },
    ],
  },
  {
    name: 'Community-acquired pneumonia',
    icd10: ['J18.9'],
    acuityRange: [6, 7],
    tier: 'high',
    baseMeds: [
      { name: 'Ceftriaxone', dose: '1 g', route: 'IV', frequency: 'q24h' },
      { name: 'Azithromycin', dose: '500 mg', route: 'IV', frequency: 'daily' },
      { name: 'Acetaminophen', dose: '650 mg', route: 'PO', frequency: 'q6h PRN' },
    ],
  },
  {
    name: 'Upper gastrointestinal hemorrhage',
    icd10: ['K92.0'],
    acuityRange: [6, 7],
    tier: 'high',
    baseMeds: [
      { name: 'Pantoprazole', dose: '80 mg', route: 'IV', frequency: 'bolus then 8 mg/hr' },
      { name: 'Octreotide', dose: '50 mcg/hr', route: 'IV', frequency: 'continuous' },
      { name: 'Normal Saline', dose: '150 mL/hr', route: 'IV', frequency: 'continuous' },
    ],
  },
  {
    name: 'Acute pancreatitis',
    icd10: ['K85.9'],
    acuityRange: [6, 7],
    tier: 'high',
    baseMeds: [
      { name: 'Hydromorphone', dose: '0.5 mg', route: 'IV', frequency: 'q3h PRN' },
      { name: 'Ondansetron', dose: '4 mg', route: 'IV', frequency: 'q6h PRN' },
      { name: 'Lactated Ringers', dose: '200 mL/hr', route: 'IV', frequency: 'continuous' },
    ],
  },
  {
    name: 'Congestive heart failure exacerbation',
    icd10: ['I50.9'],
    acuityRange: [6, 7],
    tier: 'high',
    baseMeds: [
      { name: 'Furosemide', dose: '40 mg', route: 'IV', frequency: 'q12h' },
      { name: 'Lisinopril', dose: '10 mg', route: 'PO', frequency: 'daily' },
      { name: 'Carvedilol', dose: '12.5 mg', route: 'PO', frequency: 'BID' },
    ],
  },
  {
    name: 'Pulmonary embolism',
    icd10: ['I26.99'],
    acuityRange: [6, 7],
    tier: 'high',
    baseMeds: [
      { name: 'Heparin', dose: '18 units/kg/hr', route: 'IV', frequency: 'continuous' },
      { name: 'Warfarin', dose: '5 mg', route: 'PO', frequency: 'daily' },
    ],
  },
  {
    name: 'Acute kidney injury',
    icd10: ['N17.9'],
    acuityRange: [6, 7],
    tier: 'high',
    baseMeds: [
      { name: 'Sodium Bicarbonate', dose: '150 mEq in D5W', route: 'IV', frequency: 'continuous' },
      { name: 'Calcium Gluconate', dose: '1 g', route: 'IV', frequency: 'q8h PRN' },
    ],
  },
  {
    name: 'Atrial fibrillation with rapid ventricular response',
    icd10: ['I48.91'],
    acuityRange: [6, 7],
    tier: 'high',
    baseMeds: [
      { name: 'Diltiazem', dose: '5 mg/hr', route: 'IV', frequency: 'continuous' },
      { name: 'Amiodarone', dose: '150 mg', route: 'IV', frequency: 'loading then 1 mg/min' },
      { name: 'Apixaban', dose: '5 mg', route: 'PO', frequency: 'BID' },
    ],
  },

  // MEDIUM (acuity 4-5)
  {
    name: 'Post-operative recovery - appendectomy',
    icd10: ['K35.80', 'Z48.1'],
    acuityRange: [4, 5],
    tier: 'medium',
    baseMeds: [
      { name: 'Cefazolin', dose: '1 g', route: 'IV', frequency: 'q8h' },
      { name: 'Oxycodone', dose: '5 mg', route: 'PO', frequency: 'q4h PRN' },
      { name: 'Ondansetron', dose: '4 mg', route: 'IV', frequency: 'q6h PRN' },
    ],
  },
  {
    name: 'COPD exacerbation',
    icd10: ['J44.1'],
    acuityRange: [4, 5],
    tier: 'medium',
    baseMeds: [
      { name: 'Prednisone', dose: '40 mg', route: 'PO', frequency: 'daily' },
      { name: 'Albuterol', dose: '2.5 mg', route: 'NEB', frequency: 'q4h' },
      { name: 'Ipratropium', dose: '0.5 mg', route: 'NEB', frequency: 'q6h' },
    ],
  },
  {
    name: 'Cellulitis of lower extremity',
    icd10: ['L03.116'],
    acuityRange: [4, 5],
    tier: 'medium',
    baseMeds: [
      { name: 'Cefazolin', dose: '2 g', route: 'IV', frequency: 'q8h' },
      { name: 'Ibuprofen', dose: '600 mg', route: 'PO', frequency: 'q6h' },
    ],
  },
  {
    name: 'Post-operative recovery - cholecystectomy',
    icd10: ['K80.20', 'Z48.1'],
    acuityRange: [4, 5],
    tier: 'medium',
    baseMeds: [
      { name: 'Ketorolac', dose: '15 mg', route: 'IV', frequency: 'q6h' },
      { name: 'Ondansetron', dose: '4 mg', route: 'IV', frequency: 'q6h PRN' },
    ],
  },
  {
    name: 'Deep vein thrombosis',
    icd10: ['I82.409'],
    acuityRange: [4, 5],
    tier: 'medium',
    baseMeds: [
      { name: 'Enoxaparin', dose: '1 mg/kg', route: 'SubQ', frequency: 'q12h' },
      { name: 'Warfarin', dose: '5 mg', route: 'PO', frequency: 'daily' },
    ],
  },
  {
    name: 'Diverticulitis',
    icd10: ['K57.32'],
    acuityRange: [4, 5],
    tier: 'medium',
    baseMeds: [
      { name: 'Ciprofloxacin', dose: '400 mg', route: 'IV', frequency: 'q12h' },
      { name: 'Metronidazole', dose: '500 mg', route: 'IV', frequency: 'q8h' },
      { name: 'Morphine', dose: '2 mg', route: 'IV', frequency: 'q4h PRN' },
    ],
  },
  {
    name: 'Urinary tract infection with bacteremia',
    icd10: ['N39.0', 'R78.81'],
    acuityRange: [4, 5],
    tier: 'medium',
    baseMeds: [
      { name: 'Ceftriaxone', dose: '1 g', route: 'IV', frequency: 'q24h' },
      { name: 'Acetaminophen', dose: '650 mg', route: 'PO', frequency: 'q6h PRN' },
    ],
  },
  {
    name: 'Hip fracture - post-ORIF',
    icd10: ['S72.009A', 'Z96.641'],
    acuityRange: [4, 5],
    tier: 'medium',
    baseMeds: [
      { name: 'Enoxaparin', dose: '40 mg', route: 'SubQ', frequency: 'daily' },
      { name: 'Oxycodone', dose: '5 mg', route: 'PO', frequency: 'q4h PRN' },
      { name: 'Acetaminophen', dose: '1000 mg', route: 'PO', frequency: 'q6h' },
    ],
  },
  {
    name: 'Type 2 diabetes with hyperglycemia',
    icd10: ['E11.65'],
    acuityRange: [4, 5],
    tier: 'medium',
    baseMeds: [
      { name: 'Insulin Glargine', dose: '20 units', route: 'SubQ', frequency: 'daily at bedtime' },
      { name: 'Insulin Lispro', dose: 'sliding scale', route: 'SubQ', frequency: 'AC meals' },
      { name: 'Metformin', dose: '500 mg', route: 'PO', frequency: 'BID' },
    ],
  },
  {
    name: 'Asthma exacerbation',
    icd10: ['J45.41'],
    acuityRange: [4, 5],
    tier: 'medium',
    baseMeds: [
      { name: 'Methylprednisolone', dose: '125 mg', route: 'IV', frequency: 'q6h' },
      { name: 'Albuterol', dose: '2.5 mg', route: 'NEB', frequency: 'q2h' },
      { name: 'Magnesium Sulfate', dose: '2 g', route: 'IV', frequency: 'once' },
    ],
  },
  {
    name: 'Small bowel obstruction',
    icd10: ['K56.60'],
    acuityRange: [4, 5],
    tier: 'medium',
    baseMeds: [
      { name: 'Normal Saline', dose: '125 mL/hr', route: 'IV', frequency: 'continuous' },
      { name: 'Ondansetron', dose: '4 mg', route: 'IV', frequency: 'q6h PRN' },
      { name: 'Morphine', dose: '2 mg', route: 'IV', frequency: 'q4h PRN' },
    ],
  },
  {
    name: 'Breast cancer - chemotherapy cycle',
    icd10: ['C50.919', 'Z51.11'],
    acuityRange: [4, 5],
    tier: 'medium',
    baseMeds: [
      { name: 'Doxorubicin', dose: '60 mg/m2', route: 'IV', frequency: 'per protocol' },
      { name: 'Ondansetron', dose: '8 mg', route: 'IV', frequency: 'q8h' },
      { name: 'Dexamethasone', dose: '12 mg', route: 'IV', frequency: 'pre-chemo' },
    ],
  },
  {
    name: 'Acute cholecystitis',
    icd10: ['K81.0'],
    acuityRange: [4, 5],
    tier: 'medium',
    baseMeds: [
      { name: 'Piperacillin-Tazobactam', dose: '3.375 g', route: 'IV', frequency: 'q6h' },
      { name: 'Morphine', dose: '4 mg', route: 'IV', frequency: 'q4h PRN' },
    ],
  },
  {
    name: 'Hypertensive urgency',
    icd10: ['I16.0'],
    acuityRange: [4, 5],
    tier: 'medium',
    baseMeds: [
      { name: 'Nicardipine', dose: '5 mg/hr', route: 'IV', frequency: 'titrate to goal' },
      { name: 'Lisinopril', dose: '20 mg', route: 'PO', frequency: 'daily' },
      { name: 'Amlodipine', dose: '10 mg', route: 'PO', frequency: 'daily' },
    ],
  },
  {
    name: 'Alcohol withdrawal',
    icd10: ['F10.239'],
    acuityRange: [4, 5],
    tier: 'medium',
    baseMeds: [
      { name: 'Lorazepam', dose: '2 mg', route: 'IV', frequency: 'CIWA protocol' },
      { name: 'Thiamine', dose: '100 mg', route: 'IV', frequency: 'daily' },
      { name: 'Folate', dose: '1 mg', route: 'PO', frequency: 'daily' },
      { name: 'Multivitamin', dose: '1 tab', route: 'PO', frequency: 'daily' },
    ],
  },
  {
    name: 'Pneumothorax - post chest tube',
    icd10: ['J93.9'],
    acuityRange: [4, 5],
    tier: 'medium',
    baseMeds: [
      { name: 'Hydrocodone-Acetaminophen', dose: '5/325 mg', route: 'PO', frequency: 'q4h PRN' },
      { name: 'Cefazolin', dose: '1 g', route: 'IV', frequency: 'q8h' },
    ],
  },

  // LOW (acuity 2-3)
  {
    name: 'Stable angina - observation',
    icd10: ['I20.9'],
    acuityRange: [2, 3],
    tier: 'low',
    baseMeds: [
      { name: 'Aspirin', dose: '81 mg', route: 'PO', frequency: 'daily' },
      { name: 'Metoprolol', dose: '25 mg', route: 'PO', frequency: 'BID' },
      { name: 'Nitroglycerin', dose: '0.4 mg', route: 'SL', frequency: 'PRN chest pain' },
    ],
  },
  {
    name: 'Controlled Type 2 diabetes - medication adjustment',
    icd10: ['E11.9'],
    acuityRange: [2, 3],
    tier: 'low',
    baseMeds: [
      { name: 'Metformin', dose: '1000 mg', route: 'PO', frequency: 'BID' },
      { name: 'Glipizide', dose: '5 mg', route: 'PO', frequency: 'daily' },
    ],
  },
  {
    name: 'Chronic kidney disease stage 3 - evaluation',
    icd10: ['N18.3'],
    acuityRange: [2, 3],
    tier: 'low',
    baseMeds: [
      { name: 'Lisinopril', dose: '10 mg', route: 'PO', frequency: 'daily' },
      { name: 'Sodium Bicarbonate', dose: '650 mg', route: 'PO', frequency: 'TID' },
    ],
  },
  {
    name: 'Iron deficiency anemia - transfusion',
    icd10: ['D50.9'],
    acuityRange: [2, 3],
    tier: 'low',
    baseMeds: [
      { name: 'Ferrous Sulfate', dose: '325 mg', route: 'PO', frequency: 'TID' },
      { name: 'Vitamin C', dose: '500 mg', route: 'PO', frequency: 'with iron' },
    ],
  },
  {
    name: 'GERD with esophagitis - observation',
    icd10: ['K21.0'],
    acuityRange: [2, 3],
    tier: 'low',
    baseMeds: [
      { name: 'Pantoprazole', dose: '40 mg', route: 'PO', frequency: 'daily' },
      { name: 'Sucralfate', dose: '1 g', route: 'PO', frequency: 'QID' },
    ],
  },
  {
    name: 'Mild heart failure - pending discharge',
    icd10: ['I50.9'],
    acuityRange: [2, 3],
    tier: 'low',
    baseMeds: [
      { name: 'Furosemide', dose: '20 mg', route: 'PO', frequency: 'daily' },
      { name: 'Lisinopril', dose: '5 mg', route: 'PO', frequency: 'daily' },
    ],
  },
  {
    name: 'Stable COPD - pulmonary rehab',
    icd10: ['J44.9'],
    acuityRange: [2, 3],
    tier: 'low',
    baseMeds: [
      { name: 'Tiotropium', dose: '18 mcg', route: 'INH', frequency: 'daily' },
      { name: 'Albuterol', dose: '2 puffs', route: 'MDI', frequency: 'q4h PRN' },
    ],
  },
  {
    name: 'Hypertension management - observation',
    icd10: ['I10'],
    acuityRange: [2, 3],
    tier: 'low',
    baseMeds: [
      { name: 'Amlodipine', dose: '5 mg', route: 'PO', frequency: 'daily' },
      { name: 'Hydrochlorothiazide', dose: '25 mg', route: 'PO', frequency: 'daily' },
    ],
  },
  {
    name: 'Osteoarthritis - pain management',
    icd10: ['M17.11'],
    acuityRange: [2, 3],
    tier: 'low',
    baseMeds: [
      { name: 'Acetaminophen', dose: '650 mg', route: 'PO', frequency: 'q6h' },
      { name: 'Meloxicam', dose: '15 mg', route: 'PO', frequency: 'daily' },
    ],
  },
  {
    name: 'Hypothyroidism - dosage adjustment',
    icd10: ['E03.9'],
    acuityRange: [2, 3],
    tier: 'low',
    baseMeds: [
      { name: 'Levothyroxine', dose: '100 mcg', route: 'PO', frequency: 'daily AM' },
    ],
  },
  {
    name: 'Benign prostatic hyperplasia - retention resolved',
    icd10: ['N40.1'],
    acuityRange: [2, 3],
    tier: 'low',
    baseMeds: [
      { name: 'Tamsulosin', dose: '0.4 mg', route: 'PO', frequency: 'daily at bedtime' },
      { name: 'Finasteride', dose: '5 mg', route: 'PO', frequency: 'daily' },
    ],
  },
  {
    name: 'Migraine - observation',
    icd10: ['G43.909'],
    acuityRange: [2, 3],
    tier: 'low',
    baseMeds: [
      { name: 'Sumatriptan', dose: '6 mg', route: 'SubQ', frequency: 'PRN' },
      { name: 'Metoclopramide', dose: '10 mg', route: 'IV', frequency: 'q6h PRN' },
    ],
  },
];

const ALLERGY_CATALOG = [
  { allergen: 'Penicillin', reaction: 'Anaphylaxis', severity: 'severe' },
  { allergen: 'Sulfa drugs', reaction: 'Rash', severity: 'moderate' },
  { allergen: 'Codeine', reaction: 'Nausea/vomiting', severity: 'mild' },
  { allergen: 'Aspirin', reaction: 'Bronchospasm', severity: 'severe' },
  { allergen: 'Iodine contrast', reaction: 'Hives', severity: 'moderate' },
  { allergen: 'Latex', reaction: 'Contact dermatitis', severity: 'moderate' },
  { allergen: 'Morphine', reaction: 'Itching', severity: 'mild' },
  { allergen: 'Cephalosporins', reaction: 'Anaphylaxis', severity: 'severe' },
  { allergen: 'NSAIDs', reaction: 'GI bleeding', severity: 'moderate' },
  { allergen: 'ACE inhibitors', reaction: 'Angioedema', severity: 'severe' },
  { allergen: 'Fluoroquinolones', reaction: 'Tendon pain', severity: 'moderate' },
  { allergen: 'Metformin', reaction: 'Lactic acidosis', severity: 'severe' },
  { allergen: 'Eggs', reaction: 'Hives', severity: 'mild' },
  { allergen: 'Shellfish', reaction: 'Anaphylaxis', severity: 'severe' },
];

// ── Nurse data ──────────────────────────────────────────────────────────

interface NurseSpec {
  name: string;
  floor: number;
  wing: 'East' | 'West';
  shift: 'day' | 'night';
  certs: string[];
  maxPatients: number;
}

// 3 nurses per floor (1 day East, 1 day West, 1 night rotating)
const NURSES: NurseSpec[] = [
  // Floor 2
  { name: 'Maria Santos', floor: 2, wing: 'East', shift: 'day', certs: ['BLS', 'ACLS', 'PALS'], maxPatients: 4 },
  { name: 'James Chen', floor: 2, wing: 'West', shift: 'day', certs: ['BLS', 'ACLS'], maxPatients: 4 },
  { name: 'Emily Davis', floor: 2, wing: 'East', shift: 'night', certs: ['BLS', 'ACLS', 'TNCC'], maxPatients: 5 },
  // Floor 3
  { name: 'Aisha Williams', floor: 3, wing: 'East', shift: 'day', certs: ['BLS', 'ACLS', 'ONS'], maxPatients: 4 },
  { name: 'Robert Kim', floor: 3, wing: 'West', shift: 'day', certs: ['BLS', 'ACLS'], maxPatients: 4 },
  { name: 'Carlos Rivera', floor: 3, wing: 'East', shift: 'night', certs: ['BLS', 'CHPN'], maxPatients: 5 },
  // Floor 4
  { name: 'Sarah Johnson', floor: 4, wing: 'East', shift: 'day', certs: ['BLS', 'ACLS', 'CCRN'], maxPatients: 3 },
  { name: 'David Patel', floor: 4, wing: 'West', shift: 'day', certs: ['BLS', 'ACLS', 'CCRN'], maxPatients: 3 },
  { name: 'Priya Sharma', floor: 4, wing: 'East', shift: 'night', certs: ['BLS', 'ACLS', 'CCRN', 'TNCC'], maxPatients: 3 },
  // Floor 5
  { name: 'Lisa Nguyen', floor: 5, wing: 'East', shift: 'day', certs: ['BLS', 'ACLS'], maxPatients: 4 },
  { name: 'Michael Brown', floor: 5, wing: 'West', shift: 'day', certs: ['BLS', 'ACLS'], maxPatients: 4 },
  { name: 'Thomas Wilson', floor: 5, wing: 'West', shift: 'night', certs: ['BLS', 'CWOCN'], maxPatients: 5 },
];

// ── Doctor data ─────────────────────────────────────────────────────────

const DOCTORS = [
  { name: 'Dr. Angela Martinez', dept: 'Cardiology', specs: ['interventional_cardiology', 'electrophysiology'] },
  { name: 'Dr. William Okafor', dept: 'Oncology', specs: ['medical_oncology', 'hematology'] },
  { name: 'Dr. Susan Lee', dept: 'Surgery', specs: ['general_surgery', 'trauma'] },
  { name: 'Dr. Richard Huang', dept: 'Internal Medicine', specs: ['critical_care', 'pulmonology'] },
];

const FRONT_DESK = [
  { name: 'Jennifer Thompson' },
  { name: 'Marcus Hall' },
];

const PHARMACISTS = [
  { name: 'Dr. Rachel Green', certs: ['PharmD', 'BCPS'] },
  { name: 'Dr. Kevin Park', certs: ['PharmD', 'BCOP'] },
];

const LAB_TECHS = [
  { name: 'Samantha Reed', certs: ['MLT', 'ASCP'] },
  { name: 'Daniel Ortiz', certs: ['MLS', 'ASCP', 'SBB'] },
];

// ── Vitals generation helpers ───────────────────────────────────────────

interface VitalBaseline {
  hr: number;
  systolic: number;
  diastolic: number;
  temp: number;
  rr: number;
  spo2: number;
  pain: number;
}

function baselineForTier(tier: string): VitalBaseline {
  switch (tier) {
    case 'critical':
      return { hr: 115, systolic: 85, diastolic: 52, temp: 38.9, rr: 26, spo2: 89, pain: 8 };
    case 'high':
      return { hr: 100, systolic: 105, diastolic: 65, temp: 38.3, rr: 22, spo2: 93, pain: 6 };
    case 'medium':
      return { hr: 82, systolic: 128, diastolic: 78, temp: 37.2, rr: 18, spo2: 96, pain: 4 };
    default: // low
      return { hr: 74, systolic: 122, diastolic: 74, temp: 36.8, rr: 16, spo2: 98, pain: 1 };
  }
}

function generateVital(baseline: VitalBaseline, tier: string): Record<string, number> {
  const volatility = tier === 'critical' ? 3 : tier === 'high' ? 2 : 1;
  return {
    heart_rate: Math.round(baseline.hr + rand(-8 * volatility, 8 * volatility)),
    bp_systolic: Math.round(baseline.systolic + rand(-10 * volatility, 10 * volatility)),
    bp_diastolic: Math.round(baseline.diastolic + rand(-6 * volatility, 6 * volatility)),
    temperature: Math.round((baseline.temp + rand(-0.4 * volatility, 0.4 * volatility)) * 10) / 10,
    respiratory_rate: Math.round(baseline.rr + rand(-3 * volatility, 3 * volatility)),
    spo2: Math.min(100, Math.max(70, Math.round(baseline.spo2 + rand(-2 * volatility, 2 * volatility)))),
    pain_scale: Math.min(10, Math.max(0, Math.round(baseline.pain + rand(-1 * volatility, 1 * volatility)))),
  };
}

// ── Main Seed Function ──────────────────────────────────────────────────

async function seed() {
  const now = new Date();
  console.log('[seed] Starting comprehensive hospital seed...');
  console.log(`[seed] Target project: ${PROJECT_ID}`);
  console.log(`[seed] Timestamp: ${now.toISOString()}`);

  // ====================================================================
  // 1. STAFF (12 nurses + 4 doctors + 2 front desk + 2 pharmacists + 2 lab techs = 22)
  // ====================================================================

  console.log('[seed] Creating 22 staff members...');
  const staffOps: Array<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }> = [];
  const nurseIds: string[] = [];
  const doctorIds: string[] = [];

  for (let i = 0; i < NURSES.length; i++) {
    const n = NURSES[i];
    const id = `nurse-${String(i + 1).padStart(3, '0')}`;
    nurseIds.push(id);

    const shiftStart = n.shift === 'day' ? '07:00' : '19:00';
    const shiftEnd = n.shift === 'day' ? '19:00' : '07:00';

    staffOps.push({
      ref: db.collection('users').doc(id),
      data: {
        _synthetic: true,
        _syntheticNote: 'SYNTHETIC DATA - NOT REAL PATIENTS - Generated for demo/grant purposes only',
        wallet_pubkey: `nurse_pubkey_${i + 1}`,
        role: 'nurse',
        name: n.name,
        department: 'Nursing',
        certifications: n.certs,
        specializations: [],
        zone_assignment: `${n.floor}-${n.wing}`,
        assigned_floor: n.floor,
        assigned_wing: n.wing,
        shift: n.shift,
        shift_start: shiftStart,
        shift_end: shiftEnd,
        max_patients: n.maxPatients,
        current_patients: [], // filled later
        npi_hash: null,
        created_at: ts(daysAgo(90)),
        updated_at: ts(now),
      },
    });
  }

  for (let i = 0; i < DOCTORS.length; i++) {
    const d = DOCTORS[i];
    const id = `doctor-${String(i + 1).padStart(3, '0')}`;
    doctorIds.push(id);
    staffOps.push({
      ref: db.collection('users').doc(id),
      data: {
        _synthetic: true,
        _syntheticNote: 'SYNTHETIC DATA - NOT REAL PATIENTS - Generated for demo/grant purposes only',
        wallet_pubkey: `doctor_pubkey_${i + 1}`,
        role: 'doctor',
        name: d.name,
        department: d.dept,
        certifications: ['MD', 'BLS', 'ACLS'],
        specializations: d.specs,
        npi_hash: `npi_${String(1234567890 + i)}`,
        created_at: ts(daysAgo(180)),
        updated_at: ts(now),
      },
    });
  }

  for (let i = 0; i < FRONT_DESK.length; i++) {
    staffOps.push({
      ref: db.collection('users').doc(`frontdesk-${String(i + 1).padStart(3, '0')}`),
      data: {
        _synthetic: true,
        _syntheticNote: 'SYNTHETIC DATA - NOT REAL PATIENTS - Generated for demo/grant purposes only',
        wallet_pubkey: `frontdesk_pubkey_${i + 1}`,
        role: 'frontdesk',
        name: FRONT_DESK[i].name,
        department: 'Administration',
        certifications: [],
        specializations: [],
        npi_hash: null,
        created_at: ts(daysAgo(120)),
        updated_at: ts(now),
      },
    });
  }

  for (let i = 0; i < PHARMACISTS.length; i++) {
    staffOps.push({
      ref: db.collection('users').doc(`pharmacist-${String(i + 1).padStart(3, '0')}`),
      data: {
        _synthetic: true,
        _syntheticNote: 'SYNTHETIC DATA - NOT REAL PATIENTS - Generated for demo/grant purposes only',
        wallet_pubkey: `pharmacist_pubkey_${i + 1}`,
        role: 'pharmacist',
        name: PHARMACISTS[i].name,
        department: 'Pharmacy',
        certifications: PHARMACISTS[i].certs,
        specializations: ['medication_review', 'drug_interaction'],
        npi_hash: `npi_pharm_${i + 1}`,
        created_at: ts(daysAgo(150)),
        updated_at: ts(now),
      },
    });
  }

  for (let i = 0; i < LAB_TECHS.length; i++) {
    staffOps.push({
      ref: db.collection('users').doc(`labtech-${String(i + 1).padStart(3, '0')}`),
      data: {
        _synthetic: true,
        _syntheticNote: 'SYNTHETIC DATA - NOT REAL PATIENTS - Generated for demo/grant purposes only',
        wallet_pubkey: `labtech_pubkey_${i + 1}`,
        role: 'lab_tech',
        name: LAB_TECHS[i].name,
        department: 'Laboratory',
        certifications: LAB_TECHS[i].certs,
        specializations: ['hematology', 'chemistry', 'microbiology'],
        npi_hash: null,
        created_at: ts(daysAgo(100)),
        updated_at: ts(now),
      },
    });
  }

  await batchWrite(staffOps);
  console.log('[seed] Staff created.');

  // ====================================================================
  // 2. BEDS (120 = 30 per floor, 15 per wing)
  // ====================================================================

  console.log('[seed] Creating 120 beds...');
  const bedOps: Array<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }> = [];
  // Track bed IDs per floor-wing for patient assignment
  const bedMap: Record<string, string[]> = {};
  for (const f of FLOORS) {
    for (const w of WINGS) {
      bedMap[`${f}-${w}`] = [];
    }
  }

  const BED_EQUIPMENT_OPTIONS = ['telemetry', 'ventilator', 'cardiac_monitor', 'IV_pump', 'pulse_oximeter', 'suction'];
  const ISOLATION_TYPES = ['contact', 'droplet', 'airborne', 'none'];

  for (const floor of FLOORS) {
    for (const wing of WINGS) {
      for (let room = 1; room <= 15; room++) {
        const roomStr = `${floor}${wing[0]}${String(room).padStart(2, '0')}`;
        const bedId = `bed-${roomStr}`;
        bedMap[`${floor}-${wing}`].push(bedId);

        // Most available, some in cleaning/maintenance
        let status: string = 'available';
        if (room > 12) status = pick(['cleaning', 'maintenance', 'available']);

        // ICU floor 4 gets more equipment
        let equipment: string[] = ['pulse_oximeter', 'IV_pump'];
        if (floor === 4) {
          equipment = ['telemetry', 'cardiac_monitor', 'IV_pump', 'pulse_oximeter', 'ventilator'];
        } else if (floor === 2) {
          equipment = ['telemetry', 'cardiac_monitor', 'IV_pump', 'pulse_oximeter'];
        }

        bedOps.push({
          ref: db.collection('beds').doc(bedId),
          data: {
            _synthetic: true,
            _syntheticNote: 'SYNTHETIC DATA - NOT REAL PATIENTS - Generated for demo/grant purposes only',
            room: roomStr,
            floor,
            wing,
            zone: `${floor}-${wing}`,
            bed_number: 1,
            status,
            patient_id: null,
            equipment,
            isolation: false,
            isolation_type: 'none',
            updated_at: ts(now),
          },
        });
      }
    }
  }

  await batchWrite(bedOps);
  console.log('[seed] Beds created.');

  // ====================================================================
  // 3. PATIENTS (40 = 4 critical + 8 high + 16 medium + 12 low)
  // ====================================================================

  console.log('[seed] Creating 40 patients...');

  // Build diagnosis pool: 4 critical, 8 high, 16 medium, 12 low
  const criticalDx = DIAGNOSES.filter((d) => d.tier === 'critical'); // 4
  const highDx = DIAGNOSES.filter((d) => d.tier === 'high'); // 8
  const mediumDx = DIAGNOSES.filter((d) => d.tier === 'medium'); // 16
  const lowDx = DIAGNOSES.filter((d) => d.tier === 'low'); // 12

  const patientDiagnoses: DiagnosisEntry[] = [
    ...criticalDx.slice(0, 4),
    ...highDx.slice(0, 8),
    ...mediumDx.slice(0, 16),
    ...lowDx.slice(0, 12),
  ];

  // Distribute patients across floors: 10 per floor
  // Floor 4 (ICU) gets the critical + some high
  const floorAssignments: number[] = [];
  // critical -> floor 4
  for (let i = 0; i < 4; i++) floorAssignments.push(4);
  // high -> floors 2,3 (cardiac/oncology floors)
  for (let i = 0; i < 8; i++) floorAssignments.push(i < 4 ? 2 : 3);
  // medium -> spread across 3,4,5
  for (let i = 0; i < 16; i++) floorAssignments.push([3, 4, 5, 5][i % 4]);
  // low -> floor 5 (med-surg, pending discharge)
  for (let i = 0; i < 12; i++) floorAssignments.push([2, 3, 5, 5][i % 4]);

  const patientOps: Array<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }> = [];
  const bedUpdateOps: Array<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }> = [];
  const patientIds: string[] = [];

  interface PatientMeta {
    id: string;
    tier: string;
    floor: number;
    wing: string;
    nurseId: string;
    diagnosis: DiagnosisEntry;
    admissionDate: Date;
  }
  const patientMetas: PatientMeta[] = [];

  // Track which beds are used per zone
  const usedBedIdx: Record<string, number> = {};
  // Track nurse -> patients for backfill
  const nursePatients: Record<string, string[]> = {};
  for (const nid of nurseIds) nursePatients[nid] = [];

  for (let i = 0; i < 40; i++) {
    const id = `patient-${String(i + 1).padStart(3, '0')}`;
    patientIds.push(id);

    const dx = patientDiagnoses[i];
    const floor = floorAssignments[i];
    const wing: 'East' | 'West' = i % 2 === 0 ? 'East' : 'West';
    const zone = `${floor}-${wing}`;

    // Pick next available bed
    if (!(zone in usedBedIdx)) usedBedIdx[zone] = 0;
    const bedIdx = usedBedIdx[zone]++;
    const bedPool = bedMap[zone] || [];
    const bedId = bedPool[bedIdx % bedPool.length];

    // Assign nurse from this floor
    const floorNurses = NURSES.map((n, idx) => ({ ...n, id: nurseIds[idx] }))
      .filter((n) => n.floor === floor);
    // Prefer wing match, then fall back
    const wingNurses = floorNurses.filter((n) => n.wing === wing);
    const assignedNurse = wingNurses.length > 0
      ? wingNurses[i % wingNurses.length]
      : floorNurses[i % floorNurses.length];
    nursePatients[assignedNurse.id] = nursePatients[assignedNurse.id] || [];
    nursePatients[assignedNurse.id].push(id);

    // Attending physician by department
    const doctorIdx = floor === 2 ? 0 : floor === 3 ? 1 : floor === 4 ? 3 : 2;

    const acuity = Math.round(rand(dx.acuityRange[0], dx.acuityRange[1]) * 10) / 10;
    const admissionDaysAgo = dx.tier === 'critical' ? randInt(0, 2)
      : dx.tier === 'high' ? randInt(1, 5)
      : dx.tier === 'medium' ? randInt(2, 8)
      : randInt(3, 10);
    const admissionDate = daysAgo(admissionDaysAgo);

    const dob = new Date(
      randInt(1940, 1990),
      randInt(0, 11),
      randInt(1, 28),
    );

    const mrn = `MRN-${String(100001 + i)}`;
    const roomFromBed = bedId.replace('bed-', '');

    // Allergies (0-3)
    const numAllergies = pick([0, 0, 1, 1, 1, 2, 2, 3]);
    const allergies = pickN(ALLERGY_CATALOG, numAllergies);

    // NFT status
    const mintedCount = randInt(0, 5);
    const pendingCount = dx.tier === 'critical' ? randInt(1, 3) : randInt(0, 1);

    const isolation = dx.tier === 'critical' && i % 3 === 0;

    patientMetas.push({
      id,
      tier: dx.tier,
      floor,
      wing,
      nurseId: assignedNurse.id,
      diagnosis: dx,
      admissionDate,
    });

    patientOps.push({
      ref: db.collection('patients').doc(id),
      data: {
        _synthetic: true,
        _syntheticNote: 'SYNTHETIC DATA - NOT REAL PATIENTS - Generated for demo/grant purposes only',
        wallet_pubkey: `patient_pubkey_${i + 1}`,
        passport_pda: `passport_pda_${i + 1}`,
        name: `${FIRST_NAMES[i]} ${LAST_NAMES[i]}`,
        dob: ts(dob),
        mrn,
        room: roomFromBed,
        floor,
        wing,
        bed_id: bedId,
        admission_time: ts(admissionDate),
        admission_reason: dx.name,
        discharge_time: null,
        primary_diagnosis: dx.name,
        active_diagnoses: [{ name: dx.name, icd10: dx.icd10, primary: true }],
        icd_codes: dx.icd10,
        acuity_score: acuity,
        assigned_nurse: assignedNurse.id,
        attending_physician: doctorIds[doctorIdx],
        isolation_required: isolation,
        status: 'admitted',
        allergies: allergies.map((a) => ({
          allergen: a.allergen,
          reaction: a.reaction,
          severity: a.severity,
        })),
        active_medications: dx.baseMeds.map((m) => ({
          name: m.name,
          dose: m.dose,
          route: m.route,
          frequency: m.frequency,
          start_date: ts(admissionDate),
          prescribing_physician: doctorIds[doctorIdx],
        })),
        nft_status: {
          minted_count: mintedCount,
          pending_count: pendingCount,
          last_minted_at: mintedCount > 0 ? ts(hoursAgo(randInt(1, 48))) : null,
        },
        created_at: ts(admissionDate),
        updated_at: ts(now),
      },
    });

    // Update bed
    bedUpdateOps.push({
      ref: db.collection('beds').doc(bedId),
      data: {
        _synthetic: true,
        _syntheticNote: 'SYNTHETIC DATA - NOT REAL PATIENTS - Generated for demo/grant purposes only',
        status: 'occupied',
        patient_id: id,
        isolation,
        isolation_type: isolation ? pick(['contact', 'droplet']) : 'none',
        updated_at: ts(now),
      },
    });
  }

  await batchWrite(patientOps);
  await batchWrite(bedUpdateOps);

  // Backfill nurse current_patients
  const nurseUpdateOps: Array<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }> = [];
  for (const nid of nurseIds) {
    nurseUpdateOps.push({
      ref: db.collection('users').doc(nid),
      data: { _synthetic: true, _syntheticNote: 'SYNTHETIC DATA - NOT REAL PATIENTS - Generated for demo/grant purposes only', current_patients: nursePatients[nid] || [] },
    });
  }
  await batchWrite(nurseUpdateOps);
  console.log('[seed] Patients created and nurses updated.');

  // ====================================================================
  // 4. VITALS (48 per patient = 1920 total, every 4h for 8 days)
  // ====================================================================

  console.log('[seed] Creating 1920 vitals records (48 per patient)...');
  const vitalsOps: Array<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }> = [];

  for (const pm of patientMetas) {
    const baseline = baselineForTier(pm.tier);
    // 48 readings: every 4 hours for 8 days = 48 data points
    for (let v = 0; v < 48; v++) {
      const hoursBack = (47 - v) * 4; // oldest first
      const vitalTime = new Date(now.getTime() - hoursBack * 3600_000);

      // Only generate vitals after admission
      if (vitalTime < pm.admissionDate) continue;

      const vital = generateVital(baseline, pm.tier);
      const vitalId = `vitals-${pm.id}-${String(v + 1).padStart(3, '0')}`;

      vitalsOps.push({
        ref: db.collection('vitals').doc(vitalId),
        data: {
          _synthetic: true,
          _syntheticNote: 'SYNTHETIC DATA - NOT REAL PATIENTS - Generated for demo/grant purposes only',
          patient_id: pm.id,
          ...vital,
          recorded_by: pm.nurseId,
          recorded_at: ts(vitalTime),
          source: 'bedside_monitor',
          notes: null,
          created_at: ts(vitalTime),
        },
      });
    }
  }

  await batchWrite(vitalsOps);
  console.log(`[seed] ${vitalsOps.length} vitals created.`);

  // ====================================================================
  // 5. TASKS (80 distributed across nurses)
  // ====================================================================

  console.log('[seed] Creating 80 tasks...');
  const TASK_TYPES = ['medication', 'vitals', 'assessment', 'procedure', 'education', 'discharge'] as const;
  const PRIORITIES = ['critical', 'urgent', 'routine', 'low'] as const;

  const TASK_DESCRIPTIONS: Record<string, string[]> = {
    medication: [
      'Administer IV Vancomycin 1g over 60 min',
      'Administer PO Metoprolol 25mg with vitals check',
      'Heparin drip titration per protocol',
      'PRN Morphine 2mg IV - pain reassessment in 30 min',
      'Insulin sliding scale coverage AC dinner',
      'Administer IV Ceftriaxone 1g',
      'Hang new IV bag Lactated Ringers 125 mL/hr',
      'Evening medication pass - 5 PO meds',
    ],
    vitals: [
      'Q4H vital signs - full set with orthostatics',
      'Q2H neuro checks - pupil response and GCS',
      'Q1H hemodynamic monitoring - arterial line',
      'Daily weight - compare to admission',
      'Intake and output documentation - 8hr total',
      'Continuous pulse oximetry monitoring',
    ],
    assessment: [
      'Complete head-to-toe nursing assessment',
      'Skin integrity assessment - Braden scale',
      'Fall risk reassessment - Morse scale',
      'Pain reassessment using 0-10 scale',
      'Wound care evaluation - measure and stage',
      'Respiratory assessment - lung sounds bilateral',
      'Peripheral IV site assessment',
    ],
    procedure: [
      'Foley catheter care and output measurement',
      'NG tube placement verification - pH and X-ray',
      'Central line dressing change - sterile technique',
      'Blood draw for AM labs - BMP, CBC, coags',
      'Wound debridement assist with MD',
      'Chest tube output measurement and documentation',
    ],
    education: [
      'Discharge planning education - home medications',
      'Medication self-administration teaching - insulin',
      'Diabetic foot care education with handout',
      'Fall prevention counseling - call light use',
      'Post-surgical activity restrictions and guidelines',
      'Smoking cessation counseling and resources',
    ],
    discharge: [
      'Complete discharge summary documentation',
      'Arrange home health referral - wound care',
      'Medication reconciliation - compare to home meds',
      'DME coordination - walker and shower chair',
      'Schedule follow-up appointment within 7 days',
      'Discharge teaching - signs to call the doctor',
    ],
  };

  const taskOps: Array<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }> = [];

  for (let i = 0; i < 80; i++) {
    const id = `task-${String(i + 1).padStart(3, '0')}`;
    const pm = patientMetas[i % 40];
    const taskType = TASK_TYPES[i % TASK_TYPES.length];
    const descs = TASK_DESCRIPTIONS[taskType];
    const description = descs[i % descs.length];

    // Priority distribution: 10 critical, 20 urgent, 30 routine, 20 low
    let priority: string;
    if (i < 10) priority = 'critical';
    else if (i < 30) priority = 'urgent';
    else if (i < 60) priority = 'routine';
    else priority = 'low';

    const scheduledTime = new Date(now.getTime() + (i - 40) * 30 * 60_000); // spread around now

    // Status distribution: 25 completed, 10 overdue, 45 pending
    let status: string;
    let completedAt: Date | null = null;
    if (i < 25) {
      status = 'completed';
      completedAt = new Date(scheduledTime.getTime() + randInt(5, 45) * 60_000);
    } else if (i < 35) {
      status = 'overdue';
    } else {
      status = 'pending';
    }

    taskOps.push({
      ref: db.collection('tasks').doc(id),
      data: {
        _synthetic: true,
        _syntheticNote: 'SYNTHETIC DATA - NOT REAL PATIENTS - Generated for demo/grant purposes only',
        patient_id: pm.id,
        assigned_nurse: pm.nurseId,
        type: taskType,
        priority,
        description,
        scheduled_time: ts(scheduledTime),
        window_minutes: priority === 'critical' ? 15 : priority === 'urgent' ? 30 : 60,
        required_certs: taskType === 'procedure' ? ['BLS', 'ACLS'] : ['BLS'],
        estimated_minutes: taskType === 'medication' ? 10 : taskType === 'procedure' ? 25 : 15,
        status,
        completed_at: completedAt ? ts(completedAt) : null,
        completed_by: status === 'completed' ? pm.nurseId : null,
        completion_notes: status === 'completed' ? 'Completed without complications. Patient tolerated well.' : null,
        follow_up_required: i % 8 === 0,
        follow_up_reason: i % 8 === 0 ? 'Reassess in 2 hours' : null,
        created_at: ts(hoursAgo(randInt(1, 12))),
      },
    });
  }

  await batchWrite(taskOps);
  console.log('[seed] Tasks created.');

  // ====================================================================
  // 6. ALERTS (20)
  // ====================================================================

  console.log('[seed] Creating 20 alerts...');
  const ALERT_TYPES = ['vital', 'lab', 'fall', 'medication', 'sepsis', 'deterioration'] as const;
  const SEVERITIES = ['critical', 'high', 'medium', 'low'] as const;

  const ALERT_MESSAGES = [
    // Critical
    'Heart rate sustained >130 bpm for 20 minutes - immediate assessment required',
    'Systolic BP 72 mmHg - vasopressor titration needed',
    'SpO2 84% on 6L NC - consider BiPAP or intubation',
    'Lactate 6.2 mmol/L - sepsis bundle activation',
    'Troponin 2.84 ng/mL - cardiology consult STAT',
    // High
    'Modified Early Warning Score 7 - rapid response team consideration',
    'Blood glucose 38 mg/dL - hypoglycemia protocol initiated',
    'Potassium 6.1 mEq/L - ECG and calcium gluconate ordered',
    'INR 5.8 - hold warfarin, vitamin K ordered',
    'Hemoglobin 6.4 g/dL - transfusion threshold reached',
    // Medium
    'Temperature 38.8C for 6 hours - blood cultures pending',
    'Urine output 18 mL/hr for past 4 hours - fluid bolus ordered',
    'New-onset confusion - CAM assessment positive',
    'Fall risk score increased from 35 to 55 - precautions updated',
    'Respiratory rate 24/min sustained - ABG ordered',
    // Low
    'Pain score 5/10 at reassessment - PRN medication available',
    'Missed scheduled vital signs - nurse notified',
    'Dietary consult pending > 24 hours',
    'Physical therapy evaluation not yet completed',
    'QTc 480 ms - within monitoring range',
  ];

  const alertOps: Array<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }> = [];

  for (let i = 0; i < 20; i++) {
    const id = `alert-${String(i + 1).padStart(3, '0')}`;
    const pm = patientMetas[i % 40];

    const severity = i < 5 ? 'critical' : i < 10 ? 'high' : i < 15 ? 'medium' : 'low';
    const alertType = ALERT_TYPES[i % ALERT_TYPES.length];
    const createdAt = hoursAgo(rand(0, 8));

    const acknowledged = i >= 8 && i < 16; // 8 acknowledged
    const escalated = i < 3; // 3 escalated

    alertOps.push({
      ref: db.collection('alerts').doc(id),
      data: {
        _synthetic: true,
        _syntheticNote: 'SYNTHETIC DATA - NOT REAL PATIENTS - Generated for demo/grant purposes only',
        patient_id: pm.id,
        type: alertType,
        severity,
        original_severity: severity,
        message: ALERT_MESSAGES[i],
        triage_reason: escalated ? 'MediBrain AI triage: elevated acuity and trending deterioration' : null,
        is_significant: severity === 'critical' || severity === 'high',
        acknowledged,
        acknowledged_by: acknowledged ? pm.nurseId : null,
        acknowledged_at: acknowledged ? ts(hoursAgo(rand(0, 2))) : null,
        escalated,
        escalated_to: escalated ? doctorIds[randInt(0, 3)] : null,
        created_at: ts(createdAt),
      },
    });
  }

  await batchWrite(alertOps);
  console.log('[seed] Alerts created.');

  // ====================================================================
  // 7. APPOINTMENTS (10 for today/tomorrow)
  // ====================================================================

  console.log('[seed] Creating 10 appointments...');
  const DEPARTMENTS = ['Cardiology', 'Oncology', 'Surgery', 'Internal Medicine', 'Radiology'];
  const APPT_REASONS = [
    'Follow-up cardiac catheterization review',
    'Pre-surgical clearance evaluation',
    'Chemotherapy cycle 3 of 6 - Doxorubicin/Cyclophosphamide',
    'Cardiac stress test - Bruce protocol',
    'MRI brain with and without contrast',
    'Wound check - surgical site 2 weeks post-op',
    'Lab results review - comprehensive metabolic panel',
    'Medication adjustment - warfarin dosing',
    'Physical therapy evaluation - gait training',
    'Nutrition counseling - diabetic diet education',
  ];

  const apptOps: Array<{ ref: FirebaseFirestore.DocumentReference; data: Record<string, unknown> }> = [];

  for (let i = 0; i < 10; i++) {
    const id = `appt-${String(i + 1).padStart(3, '0')}`;
    const pm = patientMetas[i];

    // Spread across today and tomorrow
    const apptDay = i < 6 ? 0 : 1;
    const apptHour = 8 + i;
    const apptTime = new Date(now);
    apptTime.setDate(apptTime.getDate() + apptDay);
    apptTime.setHours(apptHour, 0, 0, 0);

    const doctorIdx = i % DOCTORS.length;
    const statuses = ['scheduled', 'confirmed', 'checked_in', 'scheduled', 'confirmed',
      'scheduled', 'scheduled', 'confirmed', 'scheduled', 'scheduled'];

    apptOps.push({
      ref: db.collection('appointments').doc(id),
      data: {
        _synthetic: true,
        _syntheticNote: 'SYNTHETIC DATA - NOT REAL PATIENTS - Generated for demo/grant purposes only',
        patient_id: pm.id,
        patient_name: `${FIRST_NAMES[i]} ${LAST_NAMES[i]}`,
        provider_pubkey: doctorIds[doctorIdx],
        provider_name: DOCTORS[doctorIdx].name,
        department: DEPARTMENTS[i % DEPARTMENTS.length],
        appointment_time: ts(apptTime),
        duration_minutes: 30,
        reason: APPT_REASONS[i],
        status: statuses[i],
        insurance_verified: i % 3 !== 0,
        notes: i < 3 ? 'Patient requires wheelchair transport' : null,
        created_at: ts(daysAgo(3)),
      },
    });
  }

  await batchWrite(apptOps);
  console.log('[seed] Appointments created.');

  // ====================================================================
  // SUMMARY
  // ====================================================================

  console.log('\n[seed] === SEED COMPLETE ===');
  console.log(`[seed]   22 staff (12 nurses, 4 doctors, 2 front desk, 2 pharmacists, 2 lab techs)`);
  console.log(`[seed]   120 beds (30 per floor, 15 per wing)`);
  console.log(`[seed]   40 patients (4 critical, 8 high, 16 medium, 12 low)`);
  console.log(`[seed]   ${vitalsOps.length} vitals records (~48 per patient, q4h x 8 days)`);
  console.log(`[seed]   80 tasks (25 completed, 10 overdue, 45 pending)`);
  console.log(`[seed]   20 alerts (5 critical, 5 high, 5 medium, 5 low)`);
  console.log(`[seed]   10 appointments (today/tomorrow)`);
  console.log('[seed] Done.');
}

// ── Run ─────────────────────────────────────────────────────────────────

seed()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[seed] Fatal error:', err);
    process.exit(1);
  });
