export interface Patient {
  id: string;
  name: string;
  room: string;
  floor: number;
  bedId: string;
  admissionTime: string;
  acuityScore: number;
  primaryDiagnosis: string;
  icdCodes: string[];
  assignedNurse?: string;
  pendingTasks: NursingTask[];
  alerts: PatientAlert[];
  vitals: VitalSigns;
  isolationRequired: boolean;
}

export interface Nurse {
  id: string;
  name: string;
  certifications: string[];
  currentFloor: number;
  shiftStart: string;
  shiftEnd: string;
  assignedPatients: string[];
  currentLocation: { x: number; y: number; floor: number };
  breaksTaken: number;
  maxPatients: number;
}

export interface NursingTask {
  id: string;
  patientId: string;
  type: 'medication' | 'vitals' | 'assessment' | 'procedure' | 'education' | 'discharge';
  priority: 'critical' | 'urgent' | 'routine' | 'low';
  description: string;
  scheduledTime: string;
  windowMinutes: number;
  requiredCerts: string[];
  estimatedMinutes: number;
  completedAt?: string;
}

export interface PatientAlert {
  id: string;
  patientId: string;
  type: 'vital_sign' | 'lab_result' | 'fall_risk' | 'medication' | 'sepsis' | 'deterioration';
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  timestamp: string;
  acknowledged: boolean;
  acknowledgedBy?: string;
  isFalseAlarm?: boolean;
}

export interface VitalSigns {
  heartRate?: number;
  systolicBP?: number;
  diastolicBP?: number;
  temperature?: number;
  respiratoryRate?: number;
  spO2?: number;
  painLevel?: number;
  timestamp: string;
}

export interface NurseAssignment {
  nurseId: string;
  taskQueue: ScheduledTask[];
  totalWalkDistance: number;
  estimatedCompletionTime: string;
  workloadScore: number;
}

export interface ScheduledTask extends NursingTask {
  assignedNurseId: string;
  routeOrder: number;
  estimatedStartTime: string;
  walkDistanceFromPrevious: number;
}

export interface HandoffReport {
  nurseId: string;
  shiftEnd: string;
  patients: Array<{
    patientId: string;
    name: string;
    room: string;
    acuityScore: number;
    keyIssues: string[];
    pendingTasks: string[];
    recentChanges: string[];
  }>;
  generatedAt: string;
}
