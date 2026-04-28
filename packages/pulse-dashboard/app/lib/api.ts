/**
 * Dashboard API client — connects to Medi-Hive API server.
 *
 * In dev mode, sends X-MediHive-Dev: true to skip signature verification.
 * In production, wallet-signs every request with Ed25519.
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

type MediRole = 'patient' | 'doctor' | 'nurse' | 'admin' | 'pharmacy' | 'lab' | 'billing' | 'frontdesk';

interface ApiOptions {
  role: MediRole;
  pubkey?: string;
}

async function apiFetch<T>(path: string, options: ApiOptions & RequestInit = { role: 'admin' }): Promise<T> {
  const { role, pubkey, ...fetchOptions } = options;

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-MediHive-Role': role,
    'X-MediHive-Dev': 'true',  // Skip signature in dev
    'X-MediHive-Pubkey': pubkey ?? 'dev-admin-pubkey',
    ...(fetchOptions.headers as Record<string, string> ?? {}),
  };

  const response = await fetch(`${API_BASE}${path}`, {
    ...fetchOptions,
    headers,
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error((error as { error?: string }).error ?? `API error: ${response.status}`);
  }

  return response.json() as Promise<T>;
}

// === Admin Portal API ===

export const adminApi = {
  getDashboard: () => apiFetch<DashboardMetrics>('/admin/dashboard', { role: 'admin' }),
  getStaffing: () => apiFetch<{ staff: StaffMember[] }>('/admin/staffing', { role: 'admin' }),
  getBeds: () => apiFetch<{ beds: Bed[] }>('/admin/beds', { role: 'admin' }),
  getCompliance: () => apiFetch<ComplianceData>('/admin/compliance', { role: 'admin' }),
  getSystemHealth: () => apiFetch<SystemHealth>('/admin/system/health', { role: 'admin' }),
};

// === Nurse Portal API ===

export const nurseApi = {
  getTasks: (pubkey: string) => apiFetch<{ tasks: Task[]; count: number }>('/nurse/tasks', { role: 'nurse', pubkey }),
  completeTask: (taskId: string, body: { notes?: string; followUpRequired?: boolean; followUpReason?: string }) =>
    apiFetch('/nurse/tasks/' + taskId + '/complete', { role: 'nurse', method: 'PUT', body: JSON.stringify(body) }),
  recordVitals: (patientId: string, vitals: VitalsInput) =>
    apiFetch<{ status: string; acuityScore: number; alertsGenerated: number }>(
      '/nurse/patient/' + patientId + '/vitals', { role: 'nurse', method: 'POST', body: JSON.stringify(vitals) }
    ),
  getAlerts: (pubkey: string) => apiFetch<{ alerts: Alert[] }>('/nurse/alerts', { role: 'nurse', pubkey }),
  acknowledgeAlert: (alertId: string) =>
    apiFetch('/nurse/alerts/' + alertId + '/acknowledge', { role: 'nurse', method: 'PUT' }),
  generateHandoff: (pubkey: string) =>
    apiFetch<HandoffReport>('/nurse/handoff/generate', { role: 'nurse', pubkey, method: 'POST' }),
  scanMedication: (patientId: string, body: MedicationScan) =>
    apiFetch<BCMAResult>('/nurse/patient/' + patientId + '/medication/scan', { role: 'nurse', method: 'POST', body: JSON.stringify(body) }),
  administerMedication: (patientId: string, body: MedicationAdmin) =>
    apiFetch('/nurse/patient/' + patientId + '/medication/administer', { role: 'nurse', method: 'POST', body: JSON.stringify(body) }),
};

// === Doctor Portal API ===

export const doctorApi = {
  getPatients: (pubkey: string) => apiFetch<{ patients: PatientRecord[] }>('/doctor/patients', { role: 'doctor', pubkey }),
  getChart: (patientId: string) => apiFetch<PatientChart>('/doctor/patient/' + patientId + '/chart', { role: 'doctor' }),
  startScribe: (patientId: string) =>
    apiFetch<{ sessionId: string }>('/doctor/scribe/start', { role: 'doctor', method: 'POST', body: JSON.stringify({ patientId }) }),
  addTranscript: (sessionId: string, segments: TranscriptSegment[]) =>
    apiFetch('/doctor/scribe/' + sessionId + '/transcript', { role: 'doctor', method: 'POST', body: JSON.stringify({ segments }) }),
  generateSOAP: (sessionId: string) =>
    apiFetch<{ soapNote: SOAPNote; status: string }>('/doctor/scribe/' + sessionId + '/generate', { role: 'doctor', method: 'POST' }),
  signNote: (sessionId: string) =>
    apiFetch<{ status: string; message: string }>('/doctor/scribe/' + sessionId + '/sign', { role: 'doctor', method: 'POST' }),
  createOrder: (body: { patientId: string; type: string; description: string; priority?: string }) =>
    apiFetch<{ taskId: string }>('/doctor/orders', { role: 'doctor', method: 'POST', body: JSON.stringify(body) }),
};

// === Patient Portal API ===

export const patientApi = {
  getPassport: (pubkey: string) => apiFetch<PatientRecord>('/patient/passport', { role: 'patient', pubkey }),
  getRecords: (pubkey: string) => apiFetch<{ records: MedicalRecordEntry[] }>('/patient/records', { role: 'patient', pubkey }),
  getGrants: (pubkey: string) => apiFetch<{ grants: GrantEntry[] }>('/patient/grants', { role: 'patient', pubkey }),
  getAudit: (pubkey: string) => apiFetch<{ auditTrail: AuditEntry[] }>('/patient/audit', { role: 'patient', pubkey }),
};

// === Pharmacy API ===

export const pharmacyApi = {
  getOrders: () => apiFetch<{ orders: Task[] }>('/pharmacy/orders', { role: 'pharmacy' }),
  checkInteractions: (medications: string[]) =>
    apiFetch<InteractionResult>('/pharmacy/interaction-check', { role: 'pharmacy', method: 'POST', body: JSON.stringify({ medications }) }),
  fillOrder: (orderId: string) =>
    apiFetch('/pharmacy/orders/' + orderId + '/fill', { role: 'pharmacy', method: 'POST' }),
};

// === Front Desk API ===

export const frontdeskApi = {
  lookupPatient: (query: { name?: string; mrn?: string }) =>
    apiFetch<{ patients: PatientRecord[] }>('/frontdesk/patient/lookup?' + new URLSearchParams(query as Record<string, string>), { role: 'frontdesk' }),
  register: (body: { name: string; mrn?: string }) =>
    apiFetch<{ patientId: string; mrn: string }>('/frontdesk/register', { role: 'frontdesk', method: 'POST', body: JSON.stringify(body) }),
  checkin: (body: { patientId?: string; appointmentId?: number }) =>
    apiFetch('/frontdesk/checkin', { role: 'frontdesk', method: 'POST', body: JSON.stringify(body) }),
  getSchedule: () => apiFetch<{ appointments: Appointment[] }>('/frontdesk/schedule', { role: 'frontdesk' }),
};

// === Types ===

export interface DashboardMetrics {
  patients: { total: number; avgAcuity: number; acuityDistribution: { critical: number; high: number; medium: number; low: number } };
  nurses: { total: number };
  beds: { total: number; occupied: number; occupancyRate: number };
  alerts: { today: number; active: number; suppressed: number; reductionRate: number };
  tasks: { today: number; completed: number };
  blockchain: { transactionsToday: number };
  timestamp: string;
}

export interface PatientRecord {
  id: string; name: string; mrn?: string; room?: string; floor?: number;
  primary_diagnosis?: string; acuity_score?: number; icd_codes?: string[];
  status?: string; assigned_nurse?: string; attending_physician?: string;
}

export interface PatientChart {
  patient: PatientRecord;
  vitals: VitalsRecord[];
  medications: MedicationRecord[];
  notes: ScribeSession[];
  alerts: Alert[];
}

export interface Task {
  id: string; patient_id: string; type: string; priority: string;
  description: string; scheduled_time: string; completed_at?: string;
  patient_name?: string; room?: string; acuity_score?: number;
}

export interface Alert {
  id: string; patient_id: string; type: string; severity: string;
  message: string; acknowledged: boolean; created_at: string;
  patient_name?: string; room?: string; acuity_score?: number;
}

export interface VitalsRecord {
  heart_rate?: number; systolic_bp?: number; diastolic_bp?: number;
  temperature?: number; respiratory_rate?: number; spo2?: number;
  pain_level?: number; recorded_at: string; assessment_notes?: string;
}

export interface VitalsInput {
  heartRate?: number; systolicBP?: number; diastolicBP?: number;
  temperature?: number; respiratoryRate?: number; spO2?: number;
  painLevel?: number; notes?: string;
}

export interface MedicationRecord {
  medication: string; dose: string; route: string;
  bcma_verified: boolean; administered_at: string;
}

export interface MedicationScan {
  barcode: string; orderedMedication: string; orderedDose: string;
  orderedRoute: string; scheduledTime: string;
}

export interface MedicationAdmin {
  medication: string; dose: string; route: string;
  site?: string; bcmaVerified: boolean;
}

export interface BCMAResult {
  verified: boolean; warnings: string[]; patientId: string; medication: string;
}

export interface SOAPNote {
  subjective: string; objective: string; assessment: string; plan: string;
  icdCodes: Array<{ code: string; display: string }>;
  cptCodes: Array<{ code: string; display: string }>;
}

export interface ScribeSession {
  id: string; soap_note: SOAPNote; review_status: string;
  start_time: string; record_nft_tx?: string;
}

export interface TranscriptSegment {
  speaker: string; text: string; startTime: number; endTime: number;
}

export interface HandoffReport {
  handoff: Array<{ patientId: string; name: string; room: string; acuity: number;
    diagnosis: string; recentVitals: unknown; pendingTasks: unknown; activeAlerts: unknown }>;
  generatedAt: string;
}

export interface InteractionResult {
  medications: string[]; interactions: Array<{ drug1: string; drug2: string;
    severity: string; effect: string; recommendation: string }>;
  hasCritical: boolean; summary: string;
}

export interface StaffMember {
  wallet_pubkey: string; name: string; role: string; department?: string;
  certifications: string[]; patient_count: number; pending_tasks: number;
}

export interface Bed {
  id: string; room: string; floor: number; wing: string; zone: string;
  status: string; patient_name?: string; acuity_score?: number;
}

export interface ComplianceData {
  auditEntries30d: number; emergencyAccesses30d: number;
  consentChanges30d: number; authAttempts30d: number;
  hipaaStatus: string; lastAudit: string;
}

export interface SystemHealth {
  database: string; solana: string; fhir: string;
  ipfs: string; arweave: string; uptime: number;
}

export interface GrantEntry {
  entity_id: string; grantee_name?: string; grantee_role?: string; synced_at: string;
}

export interface MedicalRecordEntry {
  id: string; soap_note: SOAPNote; review_status: string;
  start_time: string; record_nft_tx?: string;
}

export interface AuditEntry {
  action: string; actor: string; timestamp: string;
}

export interface Appointment {
  id: number; patient_name: string; provider_name?: string;
  department?: string; appointment_time: string; status: string;
}
