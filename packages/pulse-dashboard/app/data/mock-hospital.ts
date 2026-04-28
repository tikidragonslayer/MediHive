export interface MockPatient {
  id: string;
  name: string;
  room: string;
  floor: number;
  age: number;
  gender: string;
  admissionDate: string;
  primaryDiagnosis: string;
  acuityScore: number;
  icdCodes: string[];
  assignedNurse: string;
  vitals: { heartRate: number; systolicBP: number; diastolicBP: number; temperature: number; respiratoryRate: number; spO2: number; painLevel: number };
  medications: Array<{ name: string; dosage: string; frequency: string }>;
  allergies: string[];
  alerts: Array<{ type: string; severity: "critical" | "high" | "medium" | "low"; message: string; time: string; acknowledged: boolean }>;
  pendingTasks: Array<{ type: string; description: string; priority: "critical" | "urgent" | "routine" | "low"; scheduledTime: string }>;
  nftStatus: { passportMinted: boolean; recordCount: number; activeGrants: number; lastUpdated: string };
}

export interface MockNurse {
  id: string;
  name: string;
  certifications: string[];
  currentFloor: number;
  shiftStart: string;
  shiftEnd: string;
  assignedPatients: string[];
  maxPatients: number;
  workloadScore: number;
}

export interface MockData {
  patients: MockPatient[];
  nurses: MockNurse[];
  hospitalMetrics: {
    totalBeds: number;
    occupiedBeds: number;
    totalStaff: number;
    avgAcuity: number;
    alertsToday: number;
    alertsSuppressed: number;
    recordsMintedToday: number;
    solanaTransactions: number;
  };
}

export const MOCK_DATA: MockData = {
  patients: [
    // === CRITICAL (2) ===
    {
      id: "P001", name: "James Mitchell", room: "412", floor: 4, age: 62, gender: "Male",
      admissionDate: "2026-03-22T08:30:00Z", primaryDiagnosis: "Sepsis secondary to UTI",
      acuityScore: 9.2, icdCodes: ["A41.9", "N39.0", "R65.20"],
      assignedNurse: "N001",
      vitals: { heartRate: 118, systolicBP: 82, diastolicBP: 48, temperature: 39.4, respiratoryRate: 28, spO2: 90, painLevel: 7 },
      medications: [
        { name: "Piperacillin-Tazobactam", dosage: "4.5g IV", frequency: "Q6H" },
        { name: "Norepinephrine", dosage: "0.1 mcg/kg/min", frequency: "Continuous" },
        { name: "Normal Saline", dosage: "500mL bolus", frequency: "PRN" },
        { name: "Acetaminophen", dosage: "1000mg IV", frequency: "Q6H" },
      ],
      allergies: ["Penicillin", "Sulfa"],
      alerts: [
        { type: "deterioration", severity: "critical", message: "Sepsis bundle triggered -- MAP 59 mmHg, lactate pending", time: "2026-03-24T14:15:00Z", acknowledged: false },
        { type: "vital_sign", severity: "critical", message: "SBP 82 mmHg -- hypotensive on vasopressor", time: "2026-03-24T14:30:00Z", acknowledged: false },
        { type: "vital_sign", severity: "high", message: "Temp 39.4C -- febrile on antibiotics", time: "2026-03-24T14:30:00Z", acknowledged: false },
      ],
      pendingTasks: [
        { type: "medication", description: "Piperacillin-Tazobactam 4.5g IV", priority: "critical", scheduledTime: "2026-03-24T15:00:00Z" },
        { type: "lab", description: "STAT lactate level", priority: "critical", scheduledTime: "2026-03-24T14:45:00Z" },
        { type: "vitals", description: "Q15min vital signs -- sepsis protocol", priority: "critical", scheduledTime: "2026-03-24T14:45:00Z" },
      ],
      nftStatus: { passportMinted: true, recordCount: 18, activeGrants: 3, lastUpdated: "2026-03-24T14:28:00Z" },
    },
    {
      id: "P002", name: "Robert Chen", room: "410", floor: 4, age: 78, gender: "Male",
      admissionDate: "2026-03-21T10:00:00Z", primaryDiagnosis: "Acute decompensated heart failure",
      acuityScore: 8.8, icdCodes: ["I50.9", "J81.0", "I10", "E11.9"],
      assignedNurse: "N001",
      vitals: { heartRate: 112, systolicBP: 88, diastolicBP: 54, temperature: 36.5, respiratoryRate: 30, spO2: 86, painLevel: 5 },
      medications: [
        { name: "Furosemide", dosage: "80mg IV", frequency: "Q8H" },
        { name: "Dobutamine", dosage: "5 mcg/kg/min", frequency: "Continuous" },
        { name: "Metoprolol", dosage: "12.5mg", frequency: "BID" },
        { name: "Lisinopril", dosage: "5mg", frequency: "QD" },
        { name: "Insulin glargine", dosage: "18 units", frequency: "QHS" },
      ],
      allergies: ["Codeine", "Iodine contrast"],
      alerts: [
        { type: "vital_sign", severity: "critical", message: "SpO2 86% on 4L NC -- escalate O2", time: "2026-03-24T14:45:00Z", acknowledged: false },
        { type: "deterioration", severity: "critical", message: "NEWS2 score 9 -- rapid response threshold", time: "2026-03-24T14:45:00Z", acknowledged: false },
      ],
      pendingTasks: [
        { type: "medication", description: "Furosemide 80mg IV push", priority: "critical", scheduledTime: "2026-03-24T15:00:00Z" },
        { type: "assessment", description: "Respiratory assessment + ABG", priority: "critical", scheduledTime: "2026-03-24T14:50:00Z" },
        { type: "vitals", description: "Continuous SpO2 + telemetry monitoring", priority: "critical", scheduledTime: "2026-03-24T14:50:00Z" },
      ],
      nftStatus: { passportMinted: true, recordCount: 32, activeGrants: 4, lastUpdated: "2026-03-24T14:42:00Z" },
    },

    // === HIGH (4) ===
    {
      id: "P003", name: "Maria Santos", room: "414", floor: 4, age: 45, gender: "Female",
      admissionDate: "2026-03-23T14:00:00Z", primaryDiagnosis: "Type 2 DM with DKA",
      acuityScore: 7.5, icdCodes: ["E11.10", "E87.2", "E87.6"],
      assignedNurse: "N002",
      vitals: { heartRate: 104, systolicBP: 108, diastolicBP: 64, temperature: 37.0, respiratoryRate: 24, spO2: 96, painLevel: 4 },
      medications: [
        { name: "Insulin regular", dosage: "10 units/hr IV", frequency: "Continuous" },
        { name: "Potassium chloride", dosage: "40mEq IV", frequency: "Over 4 hrs" },
        { name: "Normal Saline", dosage: "250 mL/hr", frequency: "Continuous" },
        { name: "Ondansetron", dosage: "4mg IV", frequency: "Q6H PRN" },
      ],
      allergies: ["Metformin"],
      alerts: [
        { type: "lab_result", severity: "high", message: "K+ 2.9 mEq/L -- critically low, replace STAT", time: "2026-03-24T13:00:00Z", acknowledged: false },
        { type: "lab_result", severity: "high", message: "Glucose 428 mg/dL -- on insulin drip", time: "2026-03-24T13:30:00Z", acknowledged: true },
      ],
      pendingTasks: [
        { type: "lab", description: "BMP Q2H for DKA protocol", priority: "urgent", scheduledTime: "2026-03-24T15:00:00Z" },
        { type: "vitals", description: "Fingerstick glucose Q1H", priority: "urgent", scheduledTime: "2026-03-24T15:00:00Z" },
        { type: "medication", description: "Potassium chloride 40mEq IV", priority: "critical", scheduledTime: "2026-03-24T14:00:00Z" },
      ],
      nftStatus: { passportMinted: true, recordCount: 8, activeGrants: 2, lastUpdated: "2026-03-24T13:15:00Z" },
    },
    {
      id: "P004", name: "Dorothy Mae Harper", room: "406", floor: 4, age: 84, gender: "Female",
      admissionDate: "2026-03-23T22:00:00Z", primaryDiagnosis: "Acute ischemic stroke -- L MCA territory",
      acuityScore: 8.0, icdCodes: ["I63.9", "I10", "I48.0"],
      assignedNurse: "N002",
      vitals: { heartRate: 88, systolicBP: 168, diastolicBP: 94, temperature: 36.9, respiratoryRate: 18, spO2: 95, painLevel: 2 },
      medications: [
        { name: "Alteplase (tPA)", dosage: "0.9mg/kg IV", frequency: "Given in ED -- monitoring" },
        { name: "Apixaban", dosage: "5mg", frequency: "BID -- held 24h post-tPA" },
        { name: "Amlodipine", dosage: "10mg", frequency: "QD" },
        { name: "Atorvastatin", dosage: "80mg", frequency: "QD" },
      ],
      allergies: ["Aspirin", "NSAIDs"],
      alerts: [
        { type: "vital_sign", severity: "high", message: "SBP 168 -- target < 180 post-tPA, close monitoring", time: "2026-03-24T14:00:00Z", acknowledged: true },
        { type: "assessment", severity: "high", message: "NIH Stroke Scale due Q1H for 24 hours post-tPA", time: "2026-03-24T14:00:00Z", acknowledged: false },
      ],
      pendingTasks: [
        { type: "assessment", description: "NIHSS neuro assessment Q1H", priority: "urgent", scheduledTime: "2026-03-24T15:00:00Z" },
        { type: "vitals", description: "BP Q15min x 2h, then Q30min x 6h post-tPA", priority: "urgent", scheduledTime: "2026-03-24T14:45:00Z" },
        { type: "lab", description: "PT/INR, CBC -- 24h post-tPA labs", priority: "routine", scheduledTime: "2026-03-24T22:00:00Z" },
      ],
      nftStatus: { passportMinted: true, recordCount: 6, activeGrants: 2, lastUpdated: "2026-03-24T10:00:00Z" },
    },
    {
      id: "P005", name: "David Thompson", room: "420", floor: 4, age: 55, gender: "Male",
      admissionDate: "2026-03-23T20:00:00Z", primaryDiagnosis: "Community-acquired pneumonia with hypoxemia",
      acuityScore: 6.8, icdCodes: ["J18.9", "J96.00", "J44.1"],
      assignedNurse: "N003",
      vitals: { heartRate: 96, systolicBP: 124, diastolicBP: 78, temperature: 38.8, respiratoryRate: 24, spO2: 90, painLevel: 3 },
      medications: [
        { name: "Ceftriaxone", dosage: "2g IV", frequency: "QD" },
        { name: "Azithromycin", dosage: "500mg IV", frequency: "QD" },
        { name: "Albuterol nebulizer", dosage: "2.5mg", frequency: "Q4H" },
        { name: "Dexamethasone", dosage: "6mg IV", frequency: "QD" },
        { name: "Acetaminophen", dosage: "1000mg", frequency: "Q6H PRN" },
      ],
      allergies: ["Erythromycin"],
      alerts: [
        { type: "vital_sign", severity: "high", message: "SpO2 90% on 3L NC -- may need BiPAP", time: "2026-03-24T14:00:00Z", acknowledged: false },
        { type: "vital_sign", severity: "medium", message: "Temp 38.8C -- febrile day 2", time: "2026-03-24T14:00:00Z", acknowledged: true },
      ],
      pendingTasks: [
        { type: "medication", description: "Ceftriaxone 2g IV", priority: "routine", scheduledTime: "2026-03-24T20:00:00Z" },
        { type: "assessment", description: "Respiratory therapy eval for BiPAP", priority: "urgent", scheduledTime: "2026-03-24T15:00:00Z" },
        { type: "vitals", description: "Q4H vital signs", priority: "routine", scheduledTime: "2026-03-24T16:00:00Z" },
      ],
      nftStatus: { passportMinted: true, recordCount: 9, activeGrants: 2, lastUpdated: "2026-03-24T14:00:00Z" },
    },
    {
      id: "P006", name: "Tameka Williams", room: "318", floor: 3, age: 38, gender: "Female",
      admissionDate: "2026-03-24T02:00:00Z", primaryDiagnosis: "Acute pancreatitis -- gallstone etiology",
      acuityScore: 6.5, icdCodes: ["K85.1", "K80.10", "K86.1"],
      assignedNurse: "N003",
      vitals: { heartRate: 102, systolicBP: 118, diastolicBP: 70, temperature: 37.8, respiratoryRate: 20, spO2: 97, painLevel: 8 },
      medications: [
        { name: "Hydromorphone", dosage: "0.5mg IV", frequency: "Q3H PRN" },
        { name: "Ondansetron", dosage: "4mg IV", frequency: "Q6H PRN" },
        { name: "Lactated Ringer's", dosage: "200 mL/hr", frequency: "Continuous" },
        { name: "Pantoprazole", dosage: "40mg IV", frequency: "QD" },
      ],
      allergies: ["Morphine", "Meperidine"],
      alerts: [
        { type: "medication", severity: "high", message: "ALLERGY CHECK: Morphine ordered but patient allergic -- hydromorphone substituted", time: "2026-03-24T02:30:00Z", acknowledged: true },
      ],
      pendingTasks: [
        { type: "assessment", description: "Abdominal pain reassessment", priority: "urgent", scheduledTime: "2026-03-24T15:00:00Z" },
        { type: "lab", description: "Lipase + CMP in AM", priority: "routine", scheduledTime: "2026-03-25T05:00:00Z" },
        { type: "consult", description: "GI consult for ERCP evaluation", priority: "urgent", scheduledTime: "2026-03-24T16:00:00Z" },
      ],
      nftStatus: { passportMinted: true, recordCount: 4, activeGrants: 1, lastUpdated: "2026-03-24T12:00:00Z" },
    },

    // === MEDIUM (6) ===
    {
      id: "P007", name: "Sarah Williams", room: "308", floor: 3, age: 34, gender: "Female",
      admissionDate: "2026-03-24T06:00:00Z", primaryDiagnosis: "Appendectomy -- post-op day 0",
      acuityScore: 4.2, icdCodes: ["K35.80", "Z96.89"],
      assignedNurse: "N004",
      vitals: { heartRate: 78, systolicBP: 118, diastolicBP: 72, temperature: 37.4, respiratoryRate: 16, spO2: 98, painLevel: 5 },
      medications: [
        { name: "Morphine PCA", dosage: "1mg demand / 6min lockout", frequency: "Continuous" },
        { name: "Ondansetron", dosage: "4mg IV", frequency: "Q6H PRN" },
        { name: "Cefazolin", dosage: "1g IV", frequency: "Q8H" },
        { name: "Enoxaparin", dosage: "40mg SQ", frequency: "QD" },
      ],
      allergies: ["Latex"],
      alerts: [],
      pendingTasks: [
        { type: "medication", description: "Cefazolin 1g IV", priority: "routine", scheduledTime: "2026-03-24T16:00:00Z" },
        { type: "assessment", description: "Surgical site assessment", priority: "routine", scheduledTime: "2026-03-24T16:00:00Z" },
        { type: "education", description: "Post-op ambulation -- walk in hall x2", priority: "routine", scheduledTime: "2026-03-24T17:00:00Z" },
      ],
      nftStatus: { passportMinted: true, recordCount: 5, activeGrants: 2, lastUpdated: "2026-03-24T12:00:00Z" },
    },
    {
      id: "P008", name: "Earl Patterson", room: "302", floor: 3, age: 71, gender: "Male",
      admissionDate: "2026-03-23T11:00:00Z", primaryDiagnosis: "COPD exacerbation",
      acuityScore: 5.5, icdCodes: ["J44.1", "J96.00", "F17.210"],
      assignedNurse: "N004",
      vitals: { heartRate: 86, systolicBP: 136, diastolicBP: 82, temperature: 37.1, respiratoryRate: 22, spO2: 92, painLevel: 1 },
      medications: [
        { name: "Prednisone", dosage: "40mg", frequency: "QD x 5 days" },
        { name: "Albuterol/Ipratropium nebulizer", dosage: "3mL", frequency: "Q4H" },
        { name: "Azithromycin", dosage: "250mg", frequency: "QD x 5 days" },
        { name: "Tiotropium", dosage: "18mcg inhaler", frequency: "QD" },
      ],
      allergies: [],
      alerts: [
        { type: "vital_sign", severity: "medium", message: "SpO2 92% on 2L NC -- at baseline per pulmonology", time: "2026-03-24T12:00:00Z", acknowledged: true },
      ],
      pendingTasks: [
        { type: "medication", description: "Albuterol/Ipratropium neb", priority: "routine", scheduledTime: "2026-03-24T16:00:00Z" },
        { type: "assessment", description: "Pulmonary rehab consult", priority: "routine", scheduledTime: "2026-03-24T15:00:00Z" },
        { type: "education", description: "Smoking cessation counseling", priority: "low", scheduledTime: "2026-03-24T17:00:00Z" },
      ],
      nftStatus: { passportMinted: true, recordCount: 15, activeGrants: 3, lastUpdated: "2026-03-24T12:30:00Z" },
    },
    {
      id: "P009", name: "Linda Kowalski", room: "310", floor: 3, age: 59, gender: "Female",
      admissionDate: "2026-03-24T08:00:00Z", primaryDiagnosis: "Cellulitis L lower extremity, uncontrolled T2DM",
      acuityScore: 4.8, icdCodes: ["L03.116", "E11.65", "I83.009"],
      assignedNurse: "N004",
      vitals: { heartRate: 82, systolicBP: 142, diastolicBP: 86, temperature: 37.6, respiratoryRate: 18, spO2: 97, painLevel: 4 },
      medications: [
        { name: "Vancomycin", dosage: "1.5g IV", frequency: "Q12H" },
        { name: "Insulin glargine", dosage: "24 units", frequency: "QHS" },
        { name: "Insulin lispro", dosage: "Sliding scale", frequency: "AC+HS" },
        { name: "Lisinopril", dosage: "20mg", frequency: "QD" },
        { name: "Gabapentin", dosage: "300mg", frequency: "TID" },
      ],
      allergies: ["Cephalosporins"],
      alerts: [
        { type: "lab_result", severity: "medium", message: "Vancomycin trough due before next dose", time: "2026-03-24T18:00:00Z", acknowledged: false },
      ],
      pendingTasks: [
        { type: "medication", description: "Vancomycin 1.5g IV", priority: "routine", scheduledTime: "2026-03-24T20:00:00Z" },
        { type: "lab", description: "Vancomycin trough level", priority: "urgent", scheduledTime: "2026-03-24T18:00:00Z" },
        { type: "assessment", description: "Wound measurement + photo", priority: "routine", scheduledTime: "2026-03-24T16:00:00Z" },
      ],
      nftStatus: { passportMinted: true, recordCount: 7, activeGrants: 2, lastUpdated: "2026-03-24T10:00:00Z" },
    },
    {
      id: "P010", name: "Marcus Johnson", room: "422", floor: 4, age: 48, gender: "Male",
      admissionDate: "2026-03-24T00:30:00Z", primaryDiagnosis: "Chest pain -- NSTEMI, s/p PCI",
      acuityScore: 5.8, icdCodes: ["I21.4", "I25.10", "E78.5"],
      assignedNurse: "N005",
      vitals: { heartRate: 72, systolicBP: 126, diastolicBP: 76, temperature: 36.8, respiratoryRate: 16, spO2: 98, painLevel: 1 },
      medications: [
        { name: "Aspirin", dosage: "81mg", frequency: "QD" },
        { name: "Ticagrelor", dosage: "90mg", frequency: "BID" },
        { name: "Heparin drip", dosage: "18 units/kg/hr", frequency: "Continuous" },
        { name: "Metoprolol", dosage: "25mg", frequency: "BID" },
        { name: "Atorvastatin", dosage: "80mg", frequency: "QHS" },
      ],
      allergies: ["Clopidogrel"],
      alerts: [
        { type: "lab_result", severity: "medium", message: "Troponin trending: 0.8 -> 1.2 -> 0.9 ng/mL", time: "2026-03-24T12:00:00Z", acknowledged: true },
      ],
      pendingTasks: [
        { type: "lab", description: "Serial troponin Q6H", priority: "routine", scheduledTime: "2026-03-24T18:00:00Z" },
        { type: "vitals", description: "Telemetry monitoring -- continuous", priority: "routine", scheduledTime: "2026-03-24T15:00:00Z" },
        { type: "medication", description: "aPTT for heparin titration", priority: "urgent", scheduledTime: "2026-03-24T16:00:00Z" },
      ],
      nftStatus: { passportMinted: true, recordCount: 6, activeGrants: 2, lastUpdated: "2026-03-24T12:00:00Z" },
    },
    {
      id: "P011", name: "Patricia Nguyen", room: "316", floor: 3, age: 66, gender: "Female",
      admissionDate: "2026-03-23T16:00:00Z", primaryDiagnosis: "Hip fracture -- s/p ORIF R hip",
      acuityScore: 4.5, icdCodes: ["S72.001A", "Z96.641", "M81.0"],
      assignedNurse: "N005",
      vitals: { heartRate: 74, systolicBP: 128, diastolicBP: 74, temperature: 37.0, respiratoryRate: 16, spO2: 97, painLevel: 6 },
      medications: [
        { name: "Hydromorphone", dosage: "1mg IV", frequency: "Q4H PRN" },
        { name: "Ketorolac", dosage: "15mg IV", frequency: "Q6H x 5 days" },
        { name: "Enoxaparin", dosage: "40mg SQ", frequency: "QD" },
        { name: "Calcium + Vitamin D", dosage: "600mg/400IU", frequency: "BID" },
      ],
      allergies: ["Tramadol"],
      alerts: [],
      pendingTasks: [
        { type: "assessment", description: "PT evaluation + gait training", priority: "routine", scheduledTime: "2026-03-24T14:00:00Z" },
        { type: "medication", description: "Enoxaparin 40mg SQ", priority: "routine", scheduledTime: "2026-03-24T21:00:00Z" },
        { type: "education", description: "Fall prevention + home safety", priority: "routine", scheduledTime: "2026-03-24T16:00:00Z" },
      ],
      nftStatus: { passportMinted: true, recordCount: 10, activeGrants: 3, lastUpdated: "2026-03-24T08:00:00Z" },
    },
    {
      id: "P012", name: "William Adeyemi", room: "314", floor: 3, age: 52, gender: "Male",
      admissionDate: "2026-03-24T04:00:00Z", primaryDiagnosis: "Acute kidney injury -- prerenal",
      acuityScore: 5.2, icdCodes: ["N17.9", "E86.0", "I10"],
      assignedNurse: "N003",
      vitals: { heartRate: 88, systolicBP: 108, diastolicBP: 62, temperature: 36.9, respiratoryRate: 18, spO2: 97, painLevel: 2 },
      medications: [
        { name: "Normal Saline", dosage: "150 mL/hr", frequency: "Continuous" },
        { name: "Amlodipine", dosage: "5mg", frequency: "QD" },
        { name: "Pantoprazole", dosage: "40mg", frequency: "QD" },
      ],
      allergies: ["ACE inhibitors"],
      alerts: [
        { type: "lab_result", severity: "medium", message: "Creatinine 3.1 mg/dL (baseline 1.0) -- AKI Stage 2", time: "2026-03-24T08:00:00Z", acknowledged: true },
      ],
      pendingTasks: [
        { type: "lab", description: "BMP Q12H for AKI monitoring", priority: "urgent", scheduledTime: "2026-03-24T16:00:00Z" },
        { type: "assessment", description: "Strict I&O -- Foley in place", priority: "routine", scheduledTime: "2026-03-24T15:00:00Z" },
      ],
      nftStatus: { passportMinted: true, recordCount: 4, activeGrants: 1, lastUpdated: "2026-03-24T08:30:00Z" },
    },

    // === LOW (8) ===
    {
      id: "P013", name: "Angela Moretti", room: "204", floor: 2, age: 29, gender: "Female",
      admissionDate: "2026-03-24T10:00:00Z", primaryDiagnosis: "Migraine with aura -- observation",
      acuityScore: 2.5, icdCodes: ["G43.109"],
      assignedNurse: "N006",
      vitals: { heartRate: 68, systolicBP: 112, diastolicBP: 68, temperature: 36.6, respiratoryRate: 14, spO2: 99, painLevel: 7 },
      medications: [
        { name: "Sumatriptan", dosage: "6mg SQ", frequency: "x1 given" },
        { name: "Ketorolac", dosage: "30mg IV", frequency: "x1" },
        { name: "Ondansetron", dosage: "4mg IV", frequency: "PRN" },
        { name: "Normal Saline", dosage: "1L bolus", frequency: "x1" },
      ],
      allergies: [],
      alerts: [],
      pendingTasks: [
        { type: "assessment", description: "Reassess headache in 2 hours", priority: "routine", scheduledTime: "2026-03-24T16:00:00Z" },
        { type: "education", description: "Migraine trigger diary education", priority: "low", scheduledTime: "2026-03-24T17:00:00Z" },
      ],
      nftStatus: { passportMinted: true, recordCount: 2, activeGrants: 1, lastUpdated: "2026-03-24T11:00:00Z" },
    },
    {
      id: "P014", name: "Thomas Brennan", room: "206", floor: 2, age: 43, gender: "Male",
      admissionDate: "2026-03-24T07:00:00Z", primaryDiagnosis: "Alcohol withdrawal -- CIWA protocol",
      acuityScore: 3.8, icdCodes: ["F10.239", "F10.230"],
      assignedNurse: "N006",
      vitals: { heartRate: 94, systolicBP: 146, diastolicBP: 88, temperature: 37.2, respiratoryRate: 18, spO2: 98, painLevel: 3 },
      medications: [
        { name: "Lorazepam", dosage: "2mg IV", frequency: "Per CIWA > 10" },
        { name: "Thiamine", dosage: "100mg IV", frequency: "QD x 3 days" },
        { name: "Folic acid", dosage: "1mg", frequency: "QD" },
        { name: "Multivitamin", dosage: "1 tab", frequency: "QD" },
        { name: "Banana bag IV", dosage: "1L", frequency: "QD" },
      ],
      allergies: ["Phenytoin"],
      alerts: [
        { type: "assessment", severity: "medium", message: "CIWA score 14 -- moderate withdrawal, lorazepam given", time: "2026-03-24T13:00:00Z", acknowledged: true },
      ],
      pendingTasks: [
        { type: "assessment", description: "CIWA scoring Q1H", priority: "urgent", scheduledTime: "2026-03-24T15:00:00Z" },
        { type: "medication", description: "Thiamine 100mg IV", priority: "routine", scheduledTime: "2026-03-24T20:00:00Z" },
        { type: "vitals", description: "Q4H vital signs", priority: "routine", scheduledTime: "2026-03-24T16:00:00Z" },
      ],
      nftStatus: { passportMinted: true, recordCount: 3, activeGrants: 1, lastUpdated: "2026-03-24T10:00:00Z" },
    },
    {
      id: "P015", name: "Joyce Ann Shultz", room: "208", floor: 2, age: 76, gender: "Female",
      admissionDate: "2026-03-23T18:00:00Z", primaryDiagnosis: "Urinary tract infection",
      acuityScore: 3.0, icdCodes: ["N39.0", "R41.0"],
      assignedNurse: "N006",
      vitals: { heartRate: 76, systolicBP: 134, diastolicBP: 78, temperature: 37.8, respiratoryRate: 16, spO2: 97, painLevel: 2 },
      medications: [
        { name: "Ceftriaxone", dosage: "1g IV", frequency: "QD" },
        { name: "Acetaminophen", dosage: "650mg", frequency: "Q6H PRN" },
        { name: "Docusate", dosage: "100mg", frequency: "BID" },
      ],
      allergies: ["Fluoroquinolones", "Bactrim"],
      alerts: [],
      pendingTasks: [
        { type: "medication", description: "Ceftriaxone 1g IV", priority: "routine", scheduledTime: "2026-03-24T18:00:00Z" },
        { type: "lab", description: "UA + culture -- follow-up", priority: "low", scheduledTime: "2026-03-25T05:00:00Z" },
      ],
      nftStatus: { passportMinted: true, recordCount: 11, activeGrants: 2, lastUpdated: "2026-03-24T09:00:00Z" },
    },
    {
      id: "P016", name: "Derek Rawlings", room: "304", floor: 3, age: 31, gender: "Male",
      admissionDate: "2026-03-24T09:00:00Z", primaryDiagnosis: "Sickle cell crisis -- vaso-occlusive",
      acuityScore: 3.5, icdCodes: ["D57.00", "M79.3"],
      assignedNurse: "N005",
      vitals: { heartRate: 84, systolicBP: 122, diastolicBP: 74, temperature: 37.0, respiratoryRate: 18, spO2: 97, painLevel: 8 },
      medications: [
        { name: "Hydromorphone PCA", dosage: "0.2mg demand / 8min lockout", frequency: "Continuous" },
        { name: "Ketorolac", dosage: "15mg IV", frequency: "Q6H" },
        { name: "Normal Saline", dosage: "125 mL/hr", frequency: "Continuous" },
        { name: "Folic acid", dosage: "1mg", frequency: "QD" },
      ],
      allergies: ["Meperidine"],
      alerts: [],
      pendingTasks: [
        { type: "assessment", description: "Pain reassessment Q2H", priority: "routine", scheduledTime: "2026-03-24T16:00:00Z" },
        { type: "lab", description: "CBC + retic count in AM", priority: "low", scheduledTime: "2026-03-25T05:00:00Z" },
      ],
      nftStatus: { passportMinted: true, recordCount: 20, activeGrants: 3, lastUpdated: "2026-03-24T11:00:00Z" },
    },
    {
      id: "P017", name: "Catherine O'Brien", room: "210", floor: 2, age: 68, gender: "Female",
      admissionDate: "2026-03-24T06:30:00Z", primaryDiagnosis: "Elective total knee arthroplasty -- post-op day 0",
      acuityScore: 3.2, icdCodes: ["M17.11", "Z96.651"],
      assignedNurse: "N007",
      vitals: { heartRate: 72, systolicBP: 132, diastolicBP: 76, temperature: 37.0, respiratoryRate: 14, spO2: 98, painLevel: 5 },
      medications: [
        { name: "Oxycodone", dosage: "5mg", frequency: "Q4H PRN" },
        { name: "Celecoxib", dosage: "200mg", frequency: "BID" },
        { name: "Enoxaparin", dosage: "40mg SQ", frequency: "QD" },
        { name: "Cefazolin", dosage: "1g IV", frequency: "Q8H x 24h" },
        { name: "Ondansetron", dosage: "4mg IV", frequency: "Q6H PRN" },
      ],
      allergies: ["Sulfa drugs"],
      alerts: [],
      pendingTasks: [
        { type: "assessment", description: "PT evaluation + CPM machine", priority: "routine", scheduledTime: "2026-03-24T14:00:00Z" },
        { type: "medication", description: "Enoxaparin 40mg SQ", priority: "routine", scheduledTime: "2026-03-24T21:00:00Z" },
        { type: "education", description: "Knee replacement recovery milestones", priority: "low", scheduledTime: "2026-03-24T16:00:00Z" },
      ],
      nftStatus: { passportMinted: true, recordCount: 8, activeGrants: 2, lastUpdated: "2026-03-24T09:00:00Z" },
    },
    {
      id: "P018", name: "Raymond Hicks", room: "212", floor: 2, age: 57, gender: "Male",
      admissionDate: "2026-03-24T11:00:00Z", primaryDiagnosis: "GI bleed -- upper, hemodynamically stable",
      acuityScore: 3.8, icdCodes: ["K92.0", "K25.4", "D50.0"],
      assignedNurse: "N007",
      vitals: { heartRate: 82, systolicBP: 118, diastolicBP: 72, temperature: 36.8, respiratoryRate: 16, spO2: 98, painLevel: 2 },
      medications: [
        { name: "Pantoprazole", dosage: "80mg IV bolus then 8mg/hr", frequency: "Continuous" },
        { name: "Normal Saline", dosage: "125 mL/hr", frequency: "Continuous" },
        { name: "Ferrous sulfate", dosage: "325mg", frequency: "TID" },
      ],
      allergies: [],
      alerts: [
        { type: "lab_result", severity: "low", message: "Hgb 8.2 g/dL -- stable, monitor Q6H", time: "2026-03-24T11:30:00Z", acknowledged: true },
      ],
      pendingTasks: [
        { type: "lab", description: "CBC Q6H for serial Hgb", priority: "routine", scheduledTime: "2026-03-24T17:00:00Z" },
        { type: "consult", description: "GI consult for EGD in AM", priority: "routine", scheduledTime: "2026-03-25T07:00:00Z" },
        { type: "assessment", description: "Stool guaiac testing", priority: "routine", scheduledTime: "2026-03-24T18:00:00Z" },
      ],
      nftStatus: { passportMinted: true, recordCount: 3, activeGrants: 1, lastUpdated: "2026-03-24T11:30:00Z" },
    },
    {
      id: "P019", name: "Priya Patel", room: "306", floor: 3, age: 41, gender: "Female",
      admissionDate: "2026-03-24T08:30:00Z", primaryDiagnosis: "Asthma exacerbation -- moderate persistent",
      acuityScore: 3.0, icdCodes: ["J45.41", "J45.20"],
      assignedNurse: "N004",
      vitals: { heartRate: 78, systolicBP: 116, diastolicBP: 72, temperature: 36.7, respiratoryRate: 20, spO2: 95, painLevel: 0 },
      medications: [
        { name: "Albuterol nebulizer", dosage: "2.5mg", frequency: "Q2H" },
        { name: "Ipratropium nebulizer", dosage: "0.5mg", frequency: "Q6H" },
        { name: "Methylprednisolone", dosage: "60mg IV", frequency: "Q6H" },
        { name: "Montelukast", dosage: "10mg", frequency: "QHS" },
      ],
      allergies: ["Aspirin -- triggers bronchospasm"],
      alerts: [],
      pendingTasks: [
        { type: "medication", description: "Albuterol nebulizer", priority: "routine", scheduledTime: "2026-03-24T16:00:00Z" },
        { type: "assessment", description: "Peak flow measurement", priority: "routine", scheduledTime: "2026-03-24T16:00:00Z" },
      ],
      nftStatus: { passportMinted: true, recordCount: 5, activeGrants: 1, lastUpdated: "2026-03-24T10:00:00Z" },
    },
    {
      id: "P020", name: "Harold Whitaker", room: "214", floor: 2, age: 82, gender: "Male",
      admissionDate: "2026-03-23T20:00:00Z", primaryDiagnosis: "Dehydration with altered mental status",
      acuityScore: 3.2, icdCodes: ["E86.0", "R41.82", "E87.1"],
      assignedNurse: "N007",
      vitals: { heartRate: 70, systolicBP: 118, diastolicBP: 68, temperature: 36.4, respiratoryRate: 16, spO2: 97, painLevel: 0 },
      medications: [
        { name: "Normal Saline", dosage: "100 mL/hr", frequency: "Continuous" },
        { name: "Potassium chloride", dosage: "20mEq IV", frequency: "x1 then recheck" },
        { name: "Famotidine", dosage: "20mg IV", frequency: "BID" },
      ],
      allergies: ["Lisinopril"],
      alerts: [
        { type: "lab_result", severity: "low", message: "Na 149 mEq/L -- mild hypernatremia, improving with IVF", time: "2026-03-24T08:00:00Z", acknowledged: true },
      ],
      pendingTasks: [
        { type: "lab", description: "BMP recheck in AM", priority: "routine", scheduledTime: "2026-03-25T05:00:00Z" },
        { type: "assessment", description: "Orientation assessment + fall risk", priority: "routine", scheduledTime: "2026-03-24T16:00:00Z" },
        { type: "consult", description: "Social work -- discharge planning", priority: "low", scheduledTime: "2026-03-24T15:00:00Z" },
      ],
      nftStatus: { passportMinted: true, recordCount: 14, activeGrants: 2, lastUpdated: "2026-03-24T08:30:00Z" },
    },
  ],

  nurses: [
    // Floor 4 -- higher acuity (3 patients each)
    { id: "N001", name: "Emily Rodriguez, RN, BSN", certifications: ["BLS", "ACLS", "CCRN"], currentFloor: 4, shiftStart: "2026-03-24T07:00:00Z", shiftEnd: "2026-03-24T19:00:00Z", assignedPatients: ["P001", "P002"], maxPatients: 3, workloadScore: 9.0 },
    { id: "N002", name: "Michael Park, RN, BSN", certifications: ["BLS", "ACLS", "Cardiac-Vascular"], currentFloor: 4, shiftStart: "2026-03-24T07:00:00Z", shiftEnd: "2026-03-24T19:00:00Z", assignedPatients: ["P003", "P004"], maxPatients: 3, workloadScore: 7.8 },
    { id: "N003", name: "Jennifer Liu, RN", certifications: ["BLS", "ACLS", "Surgical", "Wound Care"], currentFloor: 3, shiftStart: "2026-03-24T07:00:00Z", shiftEnd: "2026-03-24T19:00:00Z", assignedPatients: ["P005", "P006", "P012"], maxPatients: 4, workloadScore: 6.2 },
    // Floor 3 -- moderate acuity (4 patients each)
    { id: "N004", name: "Amanda Fletcher, RN", certifications: ["BLS", "ACLS", "Med-Surg"], currentFloor: 3, shiftStart: "2026-03-24T07:00:00Z", shiftEnd: "2026-03-24T19:00:00Z", assignedPatients: ["P007", "P008", "P009", "P019"], maxPatients: 5, workloadScore: 4.5 },
    { id: "N005", name: "James Washington, RN, BSN", certifications: ["BLS", "ACLS", "Telemetry"], currentFloor: 4, shiftStart: "2026-03-24T07:00:00Z", shiftEnd: "2026-03-24T19:00:00Z", assignedPatients: ["P010", "P011", "P016"], maxPatients: 4, workloadScore: 5.0 },
    // Floor 2 -- lower acuity (3-4 patients)
    { id: "N006", name: "Sandra Kim, RN", certifications: ["BLS", "Med-Surg"], currentFloor: 2, shiftStart: "2026-03-24T07:00:00Z", shiftEnd: "2026-03-24T19:00:00Z", assignedPatients: ["P013", "P014", "P015"], maxPatients: 5, workloadScore: 3.4 },
    { id: "N007", name: "Carlos Gutierrez, RN", certifications: ["BLS", "Med-Surg", "Ortho"], currentFloor: 2, shiftStart: "2026-03-24T07:00:00Z", shiftEnd: "2026-03-24T19:00:00Z", assignedPatients: ["P017", "P018", "P020"], maxPatients: 5, workloadScore: 3.4 },
  ],

  hospitalMetrics: {
    totalBeds: 120,
    occupiedBeds: 98,
    totalStaff: 52,
    avgAcuity: 4.9,
    alertsToday: 487,
    alertsSuppressed: 342,
    recordsMintedToday: 64,
    solanaTransactions: 218,
  },
};
