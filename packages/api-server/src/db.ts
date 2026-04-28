import * as admin from 'firebase-admin';
import {
  Firestore,
  CollectionReference,
  DocumentData,
  Query,
  FieldValue,
  Timestamp,
  WhereFilterOp,
} from 'firebase-admin/firestore';

/**
 * Database layer — Firestore for operational state.
 *
 * On-chain (Solana): passports, records, grants, consents, audit log
 * Off-chain (Firestore): sessions, task queues, vitals cache, nurse state,
 *   scheduling, bed management, alert state, FHIR cache
 *
 * This is the operational database that supports real-time workflows.
 * Blockchain is the source of truth; Firestore is the fast-access cache.
 */

// ── Firebase initialization ──────────────────────────────────────────

if (!admin.apps.length) {
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    // Emulator mode — no credentials needed
    admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT || 'medi-hive-dev' });
  } else {
    // Production — uses GOOGLE_APPLICATION_CREDENTIALS env var or default credentials
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
    });
  }
}

export const db: Firestore = admin.firestore();

// Firestore settings
db.settings({ ignoreUndefinedProperties: true });

// ── Collection references ────────────────────────────────────────────

export const collections = {
  users: () => db.collection('users') as CollectionReference<DocumentData>,
  patients: () => db.collection('patients') as CollectionReference<DocumentData>,
  vitals: () => db.collection('vitals') as CollectionReference<DocumentData>,
  tasks: () => db.collection('tasks') as CollectionReference<DocumentData>,
  alerts: () => db.collection('alerts') as CollectionReference<DocumentData>,
  scribe_sessions: () => db.collection('scribe_sessions') as CollectionReference<DocumentData>,
  medication_admin: () => db.collection('medication_admin') as CollectionReference<DocumentData>,
  appointments: () => db.collection('appointments') as CollectionReference<DocumentData>,
  beds: () => db.collection('beds') as CollectionReference<DocumentData>,
  blockchain_sync: () => db.collection('blockchain_sync') as CollectionReference<DocumentData>,
  used_nonces: () => db.collection('used_nonces') as CollectionReference<DocumentData>,
} as const;

export type CollectionName = keyof typeof collections;

// ── CRUD helpers ─────────────────────────────────────────────────────

/** Get a single document by ID from a collection. Returns null if not found. */
export async function getDoc(
  collection: CollectionName,
  id: string,
): Promise<(DocumentData & { id: string }) | null> {
  const snap = await collections[collection]().doc(id).get();
  if (!snap.exists) return null;
  return { id: snap.id, ...snap.data()! };
}

/**
 * Query documents from a collection.
 * `filters` is an array of [field, operator, value] tuples.
 * Supports orderBy and limit.
 */
export async function queryDocs(
  collection: CollectionName,
  filters: Array<[string, WhereFilterOp, unknown]> = [],
  options: {
    orderBy?: [string, 'asc' | 'desc'];
    limit?: number;
    startAfter?: unknown;
  } = {},
): Promise<Array<DocumentData & { id: string }>> {
  let query: Query<DocumentData> = collections[collection]();
  for (const [field, op, value] of filters) {
    query = query.where(field, op, value);
  }
  if (options.orderBy) {
    query = query.orderBy(options.orderBy[0], options.orderBy[1]);
  }
  if (options.startAfter !== undefined) {
    query = query.startAfter(options.startAfter);
  }
  if (options.limit) {
    query = query.limit(options.limit);
  }
  const snap = await query.get();
  return snap.docs.map((doc: FirebaseFirestore.QueryDocumentSnapshot) => ({ id: doc.id, ...doc.data() }));
}

/** Create or overwrite a document. If id is omitted, auto-generates one. */
export async function upsertDoc(
  collection: CollectionName,
  data: DocumentData,
  id?: string,
): Promise<string> {
  if (id) {
    await collections[collection]().doc(id).set(data, { merge: true });
    return id;
  }
  const ref = await collections[collection]().add(data);
  return ref.id;
}

/** Delete a document by ID. */
export async function deleteDoc(collection: CollectionName, id: string): Promise<void> {
  await collections[collection]().doc(id).delete();
}

/** Batch write helper for bulk operations. */
export function createBatch() {
  return db.batch();
}

/** Firestore server timestamp helper. */
export function serverTimestamp() {
  return FieldValue.serverTimestamp();
}

/** Convert a JS Date to a Firestore Timestamp. */
export function toTimestamp(date: Date): Timestamp {
  return Timestamp.fromDate(date);
}

// ── Initialize DB ────────────────────────────────────────────────────

/**
 * Firestore auto-creates collections on first write.
 * This function serves as a readiness check and can seed initial data.
 */
export async function initDB(): Promise<void> {
  // Verify Firestore connectivity
  try {
    await db.listCollections();
    console.log('[db] Firestore connected');
  } catch (err) {
    console.error('[db] Firestore connection failed:', err);
    throw err;
  }
}

// ── Seed database with realistic hospital data ───────────────────────

export async function seedDatabase(): Promise<void> {
  console.log('[seed] Starting database seed...');

  const batch = db.batch();
  let opCount = 0;
  const MAX_BATCH = 500;

  // Helper to flush batch when approaching limit
  async function flushIfNeeded() {
    if (opCount >= MAX_BATCH - 5) {
      await batch.commit();
      opCount = 0;
    }
  }

  const now = new Date();

  // ── Wings and zones ─────────────────────────────────────────────
  const wings = ['East', 'West'];
  const zones: Record<number, string[]> = {
    2: ['2-East', '2-West'],
    3: ['3-East', '3-West'],
    4: ['4-East', '4-West'],
    5: ['5-East', '5-West'],
  };

  // ── Staff: 12 nurses ────────────────────────────────────────────
  const nurseData = [
    { name: 'Maria Santos', zone: '2-East', specializations: ['cardiac', 'telemetry'], certs: ['BLS', 'ACLS'] },
    { name: 'James Chen', zone: '2-West', specializations: ['cardiac'], certs: ['BLS', 'ACLS', 'PALS'] },
    { name: 'Aisha Williams', zone: '3-East', specializations: ['oncology'], certs: ['BLS', 'ONS'] },
    { name: 'Robert Kim', zone: '3-West', specializations: ['surgical'], certs: ['BLS', 'ACLS'] },
    { name: 'Sarah Johnson', zone: '4-East', specializations: ['icu', 'critical_care'], certs: ['BLS', 'ACLS', 'CCRN'] },
    { name: 'David Patel', zone: '4-West', specializations: ['icu'], certs: ['BLS', 'ACLS', 'CCRN'] },
    { name: 'Lisa Nguyen', zone: '5-East', specializations: ['med_surg'], certs: ['BLS'] },
    { name: 'Michael Brown', zone: '5-West', specializations: ['med_surg'], certs: ['BLS', 'ACLS'] },
    { name: 'Emily Davis', zone: '2-East', specializations: ['cardiac'], certs: ['BLS', 'ACLS'] },
    { name: 'Carlos Rivera', zone: '3-East', specializations: ['oncology', 'palliative'], certs: ['BLS', 'CHPN'] },
    { name: 'Priya Sharma', zone: '4-East', specializations: ['icu'], certs: ['BLS', 'ACLS', 'CCRN'] },
    { name: 'Thomas Wilson', zone: '5-West', specializations: ['med_surg', 'wound_care'], certs: ['BLS', 'CWOCN'] },
  ];

  const nurseIds: string[] = [];
  for (let i = 0; i < nurseData.length; i++) {
    const id = `nurse-${String(i + 1).padStart(3, '0')}`;
    nurseIds.push(id);
    batch.set(collections.users().doc(id), {
      wallet_pubkey: `nurse_pubkey_${i + 1}`,
      role: 'nurse',
      name: nurseData[i].name,
      department: 'Nursing',
      certifications: nurseData[i].certs,
      specializations: nurseData[i].specializations,
      zone_assignment: nurseData[i].zone,
      npi_hash: null,
      created_at: toTimestamp(now),
      updated_at: toTimestamp(now),
    });
    opCount++;
  }

  // ── Staff: 4 doctors ────────────────────────────────────────────
  const doctorData = [
    { name: 'Dr. Angela Martinez', dept: 'Cardiology', specs: ['interventional_cardiology'] },
    { name: 'Dr. William Okafor', dept: 'Oncology', specs: ['medical_oncology'] },
    { name: 'Dr. Susan Lee', dept: 'Surgery', specs: ['general_surgery', 'trauma'] },
    { name: 'Dr. Richard Huang', dept: 'Internal Medicine', specs: ['critical_care', 'pulmonology'] },
  ];

  const doctorIds: string[] = [];
  for (let i = 0; i < doctorData.length; i++) {
    const id = `doctor-${String(i + 1).padStart(3, '0')}`;
    doctorIds.push(id);
    batch.set(collections.users().doc(id), {
      wallet_pubkey: `doctor_pubkey_${i + 1}`,
      role: 'doctor',
      name: doctorData[i].name,
      department: doctorData[i].dept,
      certifications: ['MD', 'BLS', 'ACLS'],
      specializations: doctorData[i].specs,
      npi_hash: `npi_hash_${i + 1}`,
      created_at: toTimestamp(now),
      updated_at: toTimestamp(now),
    });
    opCount++;
  }

  // ── Staff: 2 front desk ─────────────────────────────────────────
  const frontdeskData = [
    { name: 'Jennifer Thompson' },
    { name: 'Marcus Hall' },
  ];

  for (let i = 0; i < frontdeskData.length; i++) {
    const id = `frontdesk-${String(i + 1).padStart(3, '0')}`;
    batch.set(collections.users().doc(id), {
      wallet_pubkey: `frontdesk_pubkey_${i + 1}`,
      role: 'frontdesk',
      name: frontdeskData[i].name,
      department: 'Administration',
      certifications: [],
      specializations: [],
      npi_hash: null,
      created_at: toTimestamp(now),
      updated_at: toTimestamp(now),
    });
    opCount++;
  }

  // Flush staff batch
  await batch.commit();
  opCount = 0;
  const batch2 = db.batch();

  // ── 120 Beds across floors 2-5 ─────────────────────────────────
  const bedIds: string[] = [];
  const bedsByFloor: Record<number, string[]> = { 2: [], 3: [], 4: [], 5: [] };
  let bedIndex = 0;
  for (let floor = 2; floor <= 5; floor++) {
    for (const wing of wings) {
      // 15 beds per wing per floor = 30 beds/floor * 4 floors = 120
      for (let room = 1; room <= 8; room++) {
        const bedsInRoom = room <= 7 ? 2 : 1; // 7 double rooms + 1 single = 15 beds/wing
        for (let bedNum = 1; bedNum <= bedsInRoom; bedNum++) {
          const roomStr = `${floor}${wing[0]}${String(room).padStart(2, '0')}`;
          const id = `bed-${roomStr}-${bedNum}`;
          bedIds.push(id);
          bedsByFloor[floor].push(id);
          batch2.set(collections.beds().doc(id), {
            room: roomStr,
            floor,
            wing,
            zone: `${floor}-${wing}`,
            bed_number: bedNum,
            status: 'available',
            patient_id: null,
            equipment: [],
            isolation: false,
            updated_at: toTimestamp(now),
          });
          bedIndex++;
          opCount++;
          if (opCount >= MAX_BATCH - 5) {
            await batch2.commit();
            opCount = 0;
          }
        }
      }
    }
  }

  await batch2.commit();
  opCount = 0;

  // ── 40 Patients across floors 2-5 ──────────────────────────────
  const firstNames = [
    'Alice', 'Bob', 'Carol', 'Daniel', 'Eva', 'Frank', 'Grace', 'Henry',
    'Iris', 'Jack', 'Karen', 'Leo', 'Mia', 'Nathan', 'Olivia', 'Peter',
    'Quinn', 'Rachel', 'Sam', 'Tina', 'Uma', 'Victor', 'Wendy', 'Xavier',
    'Yolanda', 'Zach', 'Amara', 'Brian', 'Camille', 'Derek', 'Elena',
    'Felix', 'Greta', 'Hassan', 'Ingrid', 'Jorge', 'Keiko', 'Liam',
    'Nadia', 'Oscar',
  ];
  const lastNames = [
    'Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller',
    'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez',
    'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin',
    'Lee', 'Perez', 'Thompson', 'White', 'Harris', 'Sanchez', 'Clark',
    'Ramirez', 'Lewis', 'Robinson', 'Walker', 'Young', 'Allen', 'King',
    'Wright', 'Scott', 'Torres', 'Nguyen', 'Hill', 'Flores',
  ];

  const diagnoses = [
    'Acute myocardial infarction', 'Congestive heart failure', 'Atrial fibrillation',
    'Community-acquired pneumonia', 'COPD exacerbation', 'Acute kidney injury',
    'Type 2 diabetes with complications', 'Cellulitis', 'Deep vein thrombosis',
    'Pulmonary embolism', 'Acute pancreatitis', 'Gastrointestinal hemorrhage',
    'Hip fracture', 'Sepsis', 'Stroke', 'Post-surgical recovery (appendectomy)',
    'Post-surgical recovery (cholecystectomy)', 'Diverticulitis', 'Urinary tract infection',
    'Breast cancer chemotherapy',
  ];

  const icdMap: Record<string, string[]> = {
    'Acute myocardial infarction': ['I21.9'],
    'Congestive heart failure': ['I50.9'],
    'Atrial fibrillation': ['I48.91'],
    'Community-acquired pneumonia': ['J18.9'],
    'COPD exacerbation': ['J44.1'],
    'Acute kidney injury': ['N17.9'],
    'Type 2 diabetes with complications': ['E11.65', 'E11.21'],
    'Cellulitis': ['L03.90'],
    'Deep vein thrombosis': ['I82.90'],
    'Pulmonary embolism': ['I26.99'],
    'Acute pancreatitis': ['K85.9'],
    'Gastrointestinal hemorrhage': ['K92.2'],
    'Hip fracture': ['S72.009A'],
    'Sepsis': ['A41.9', 'R65.20'],
    'Stroke': ['I63.9'],
    'Post-surgical recovery (appendectomy)': ['K35.80', 'Z48.1'],
    'Post-surgical recovery (cholecystectomy)': ['K80.20', 'Z48.1'],
    'Diverticulitis': ['K57.92'],
    'Urinary tract infection': ['N39.0'],
    'Breast cancer chemotherapy': ['C50.919', 'Z51.11'],
  };

  const patientIds: string[] = [];
  const patientFloors: Record<string, number> = {};
  const patientNurses: Record<string, string> = {};
  const occupiedBeds = new Set<string>();

  const batch3 = db.batch();
  for (let i = 0; i < 40; i++) {
    const id = `patient-${String(i + 1).padStart(3, '0')}`;
    patientIds.push(id);

    const floor = (i % 4) + 2; // Distribute across floors 2-5
    patientFloors[id] = floor;

    // Pick an available bed on this floor
    const availableBed = bedsByFloor[floor].find((b) => !occupiedBeds.has(b));
    const bedId = availableBed || bedsByFloor[floor][0];
    occupiedBeds.add(bedId);

    const diagnosis = diagnoses[i % diagnoses.length];
    const acuity = floor === 4 ? 7 + Math.random() * 3 : 2 + Math.random() * 6; // ICU floors are higher acuity

    // Assign nurse from same floor zone
    const floorNurses = nurseData
      .map((n, idx) => ({ ...n, id: nurseIds[idx] }))
      .filter((n) => n.zone.startsWith(`${floor}-`));
    const assignedNurse = floorNurses[i % floorNurses.length];
    patientNurses[id] = assignedNurse.id;

    // Assign doctor based on floor specialty
    const doctorIdx = floor === 2 ? 0 : floor === 3 ? 1 : floor === 4 ? 3 : 2;

    const admissionDate = new Date(now);
    admissionDate.setDate(admissionDate.getDate() - Math.floor(Math.random() * 10 + 1));

    const mrn = `MRN-${String(100000 + i).slice(0)}`;
    const roomFromBed = bedId.split('-')[1] || `${floor}E01`;

    batch3.set(collections.patients().doc(id), {
      wallet_pubkey: `patient_pubkey_${i + 1}`,
      passport_pda: `passport_pda_${i + 1}`,
      name: `${firstNames[i]} ${lastNames[i]}`,
      mrn,
      room: roomFromBed,
      floor,
      bed_id: bedId,
      admission_time: toTimestamp(admissionDate),
      discharge_time: null,
      primary_diagnosis: diagnosis,
      icd_codes: icdMap[diagnosis] || [],
      acuity_score: Math.round(acuity * 10) / 10,
      assigned_nurse: assignedNurse.id,
      attending_physician: doctorIds[doctorIdx],
      isolation_required: i % 10 === 0, // 10% isolation
      status: 'admitted',
      created_at: toTimestamp(admissionDate),
      updated_at: toTimestamp(now),
    });
    opCount++;

    // Update bed status to occupied
    batch3.update(collections.beds().doc(bedId), {
      status: 'occupied',
      patient_id: id,
      isolation: i % 10 === 0,
      updated_at: toTimestamp(now),
    });
    opCount++;

    if (opCount >= MAX_BATCH - 5) {
      await batch3.commit();
      opCount = 0;
    }
  }

  await batch3.commit();
  opCount = 0;

  // ── 80 Active tasks ────────────────────────────────────────────
  const taskTypes = ['medication', 'vitals', 'assessment', 'procedure', 'education', 'discharge'];
  const priorities = ['critical', 'urgent', 'routine', 'low'];
  const taskDescriptions: Record<string, string[]> = {
    medication: ['Administer IV Vancomycin 1g', 'Administer PO Metoprolol 25mg', 'Heparin drip rate check', 'PRN Morphine assessment', 'Insulin sliding scale'],
    vitals: ['Q4H vital signs', 'Q2H neuro checks', 'Q1H hemodynamic monitoring', 'Daily weight', 'I&O documentation'],
    assessment: ['Skin integrity assessment', 'Fall risk reassessment', 'Pain reassessment', 'Wound care evaluation', 'Respiratory assessment'],
    procedure: ['Foley catheter insertion', 'NG tube placement verification', 'Central line dressing change', 'Blood draw for labs', 'Wound debridement assist'],
    education: ['Discharge planning education', 'Medication self-administration teaching', 'Diabetic foot care education', 'Fall prevention counseling', 'Post-surgical activity guidelines'],
    discharge: ['Complete discharge summary', 'Arrange home health referral', 'Medication reconciliation', 'DME coordination', 'Follow-up appointment scheduling'],
  };

  const batch4 = db.batch();
  for (let i = 0; i < 80; i++) {
    const id = `task-${String(i + 1).padStart(3, '0')}`;
    const patientId = patientIds[i % 40];
    const nurseId = patientNurses[patientId];
    const taskType = taskTypes[i % taskTypes.length];
    const priority = priorities[Math.floor(i / 20)]; // First 20 critical, next 20 urgent, etc.
    const descs = taskDescriptions[taskType];
    const description = descs[i % descs.length];

    const scheduled = new Date(now);
    scheduled.setHours(scheduled.getHours() + Math.floor(Math.random() * 8) - 2);

    const isCompleted = i < 20; // 20 tasks already completed
    const completedAt = isCompleted ? new Date(now.getTime() - Math.random() * 3600000) : null;

    batch4.set(collections.tasks().doc(id), {
      patient_id: patientId,
      assigned_nurse: nurseId,
      type: taskType,
      priority,
      description,
      scheduled_time: toTimestamp(scheduled),
      window_minutes: priority === 'critical' ? 15 : priority === 'urgent' ? 30 : 60,
      required_certs: taskType === 'procedure' ? ['BLS', 'ACLS'] : ['BLS'],
      estimated_minutes: taskType === 'medication' ? 10 : 15,
      status: isCompleted ? 'completed' : 'pending',
      completed_at: completedAt ? toTimestamp(completedAt) : null,
      completed_by: isCompleted ? nurseId : null,
      completion_notes: isCompleted ? 'Task completed without complications' : null,
      follow_up_required: false,
      follow_up_reason: null,
      created_at: toTimestamp(now),
    });
    opCount++;

    if (opCount >= MAX_BATCH - 5) {
      await batch4.commit();
      opCount = 0;
    }
  }

  await batch4.commit();
  opCount = 0;

  // ── 20 Alerts ──────────────────────────────────────────────────
  const alertTypes = ['vital_sign', 'lab_result', 'fall_risk', 'medication', 'sepsis', 'deterioration'];
  const severities = ['critical', 'high', 'medium', 'low'];
  const alertMessages = [
    'Heart rate elevated >120 bpm for 15 minutes',
    'Systolic BP dropped below 90 mmHg',
    'SpO2 below 92% — verify sensor and reassess',
    'Potassium level 5.8 mEq/L — critical high',
    'Modified Early Warning Score 7 — rapid response consideration',
    'Fall risk score increased — reassess precautions',
    'Missed medication window — Metoprolol overdue 45 min',
    'Temperature 39.2C — blood cultures may be indicated',
    'Lactate trending up: 2.1 → 3.4 mmol/L',
    'Creatinine rising: 1.8 → 2.6 mg/dL over 24h',
    'INR 4.2 — supratherapeutic, hold warfarin',
    'Glasgow Coma Scale decreased from 14 to 11',
    'Respiratory rate 28/min sustained over 30 min',
    'New-onset confusion — consider sepsis screening',
    'Pain score 9/10 unrelieved after PRN administration',
    'Blood glucose 42 mg/dL — hypoglycemia protocol',
    'Hemoglobin 6.8 g/dL — transfusion threshold',
    'Urine output <0.5 mL/kg/hr for 6 hours',
    'Troponin trending up: 0.08 → 0.42 ng/mL',
    'QTc prolongation detected — 520 ms',
  ];

  const batch5 = db.batch();
  for (let i = 0; i < 20; i++) {
    const id = `alert-${String(i + 1).padStart(3, '0')}`;
    const patientId = patientIds[i % 40];
    const severity = severities[Math.floor(i / 5)];
    const alertType = alertTypes[i % alertTypes.length];

    const createdAt = new Date(now);
    createdAt.setMinutes(createdAt.getMinutes() - Math.floor(Math.random() * 120));

    const isAcknowledged = i < 8;
    const acknowledgedNurse = patientNurses[patientId];

    batch5.set(collections.alerts().doc(id), {
      patient_id: patientId,
      type: alertType,
      severity,
      original_severity: severity === 'critical' ? 'critical' : severities[Math.max(0, severities.indexOf(severity) - 1)],
      message: alertMessages[i],
      triage_reason: severity !== severities[Math.max(0, severities.indexOf(severity) - 1)]
        ? 'MediBrain triage adjustment based on patient context'
        : null,
      is_significant: severity === 'critical' || severity === 'high',
      acknowledged: isAcknowledged,
      acknowledged_by: isAcknowledged ? acknowledgedNurse : null,
      acknowledged_at: isAcknowledged ? toTimestamp(now) : null,
      created_at: toTimestamp(createdAt),
    });
    opCount++;
  }

  await batch5.commit();
  opCount = 0;

  // ── 10 Appointments ────────────────────────────────────────────
  const departments = ['Cardiology', 'Oncology', 'Surgery', 'Internal Medicine', 'Radiology'];
  const reasons = [
    'Follow-up after discharge', 'Pre-surgical evaluation', 'Chemotherapy session',
    'Cardiac stress test', 'MRI review', 'Wound check', 'Lab results review',
    'Medication adjustment', 'Physical therapy evaluation', 'Nutrition counseling',
  ];

  const batch6 = db.batch();
  for (let i = 0; i < 10; i++) {
    const id = `appt-${String(i + 1).padStart(3, '0')}`;
    const patientId = patientIds[i];
    const doctorIdx = i % 4;

    const apptTime = new Date(now);
    apptTime.setDate(apptTime.getDate() + Math.floor(i / 2) + 1);
    apptTime.setHours(8 + i, 0, 0, 0);

    const statuses = ['scheduled', 'scheduled', 'scheduled', 'checked_in', 'scheduled',
      'scheduled', 'scheduled', 'scheduled', 'scheduled', 'scheduled'];

    batch6.set(collections.appointments().doc(id), {
      patient_id: patientId,
      patient_name: `${firstNames[i]} ${lastNames[i]}`,
      provider_pubkey: doctorIds[doctorIdx],
      provider_name: doctorData[doctorIdx].name,
      department: departments[i % departments.length],
      appointment_time: toTimestamp(apptTime),
      duration_minutes: 30,
      reason: reasons[i],
      status: statuses[i],
      insurance_verified: i % 3 !== 0,
      created_at: toTimestamp(now),
    });
    opCount++;
  }

  await batch6.commit();
  console.log('[seed] Database seeded: 40 patients, 18 staff, 120 beds, 80 tasks, 20 alerts, 10 appointments');
}
