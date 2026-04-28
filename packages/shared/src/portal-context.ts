/**
 * Portal Context Engine — Every user gets a personalized, real-time view.
 *
 * The portal isn't role-based, it's IDENTITY-based. Two nurses see
 * completely different screens because their context is different:
 * - Assigned patients (different acuity profiles)
 * - Certifications (ICU nurse sees different tasks than med-surg)
 * - Shift phase (start = handoff, middle = rounding, end = handoff out)
 * - Current location (RTLS: which floor, near which patient?)
 * - Fatigue level (hours worked, breaks taken)
 * - Pending critical actions (overdue meds? deteriorating patient?)
 *
 * The system surfaces the MOST IMPORTANT thing right now.
 * No one should ever have to "look for" information.
 */

// === User Identity (from wallet + on-chain credential) ===

export interface UserIdentity {
  walletPubkey: string;
  role: UserRole;
  profile: UserProfile;
  shiftContext?: ShiftContext;
  locationContext?: LocationContext;
}

export type UserRole =
  | 'patient'
  | 'attending_physician'
  | 'resident'
  | 'specialist'
  | 'surgeon'
  | 'rn_icu'
  | 'rn_medsurg'
  | 'rn_er'
  | 'rn_peds'
  | 'rn_oncology'
  | 'rn_cardiac'
  | 'rn_surgical'
  | 'lpn'
  | 'cna'
  | 'charge_nurse'
  | 'nurse_manager'
  | 'pharmacist'
  | 'pharmacy_tech'
  | 'lab_tech'
  | 'radiology_tech'
  | 'respiratory_therapist'
  | 'physical_therapist'
  | 'social_worker'
  | 'case_manager'
  | 'front_desk'
  | 'registration'
  | 'billing_coder'
  | 'billing_specialist'
  | 'hospital_admin'
  | 'department_director'
  | 'cmo'
  | 'cno'
  | 'it_security';

export interface UserProfile {
  name: string;
  npiHash?: string; // Hashed NPI for clinicians
  department: string;
  certifications: string[];
  specializations: string[];
  yearsExperience?: number;
  preferredLanguage: string;
  notificationPreferences: NotificationPrefs;
}

export interface ShiftContext {
  shiftStart: string;
  shiftEnd: string;
  shiftPhase: 'arriving' | 'handoff_in' | 'active' | 'handoff_out' | 'overtime';
  hoursWorked: number;
  breaksTaken: number;
  breaksDue: number;
  assignedPatients: string[];
  assignedFloor: number;
  assignedUnit: string;
}

export interface LocationContext {
  floor: number;
  zone: string; // "4A", "ICU-2", "ER-Bay3"
  nearestPatientRoom?: string;
  lastUpdated: string;
}

export interface NotificationPrefs {
  criticalAlerts: 'always';
  highAlerts: 'badge' | 'push' | 'silent';
  routineAlerts: 'badge' | 'silent' | 'off';
  handoffReminder: boolean;
  breakReminder: boolean;
}

// === Portal View Generation ===

/**
 * Generate the personalized portal view for a user.
 * This determines WHAT they see and in WHAT ORDER.
 */
export interface PortalView {
  user: UserIdentity;
  urgentBanner?: UrgentBanner;
  primaryWidgets: Widget[];
  secondaryWidgets: Widget[];
  quickActions: QuickAction[];
  contextualNav: NavItem[];
}

export interface UrgentBanner {
  severity: 'critical' | 'high';
  message: string;
  action: QuickAction;
  patientId?: string;
  expiresAt?: string;
}

export interface Widget {
  id: string;
  type: WidgetType;
  title: string;
  priority: number; // Lower = more important, shown first
  data: unknown;
  refreshInterval: number; // seconds, 0 = static
}

export type WidgetType =
  | 'patient_list'
  | 'task_queue'
  | 'vital_signs'
  | 'medication_due'
  | 'alert_feed'
  | 'handoff_report'
  | 'lab_results'
  | 'order_queue'
  | 'bed_board'
  | 'checkin_queue'
  | 'schedule'
  | 'interaction_checker'
  | 'dispense_queue'
  | 'specimen_tracker'
  | 'coding_queue'
  | 'claims_status'
  | 'compliance_dashboard'
  | 'system_health'
  | 'scribe_recorder'
  | 'patient_chart'
  | 'acuity_overview'
  | 'blockchain_status'
  | 'nurse_workload_map'
  | 'shift_stats';

export interface QuickAction {
  label: string;
  icon: string;
  action: string; // API route
  params?: Record<string, string>;
  requiresConfirm?: boolean;
}

export interface NavItem {
  label: string;
  icon: string;
  route: string;
  badge?: number;
}

// === Portal Generator ===

export class PortalGenerator {
  /**
   * Generate a complete portal view for a user based on their identity,
   * current context, and real-time hospital state.
   */
  static generate(user: UserIdentity, hospitalState: HospitalState): PortalView {
    const roleGroup = this.getRoleGroup(user.role);

    switch (roleGroup) {
      case 'nursing': return this.generateNursingPortal(user, hospitalState);
      case 'physician': return this.generatePhysicianPortal(user, hospitalState);
      case 'frontline': return this.generateFrontlinePortal(user, hospitalState);
      case 'pharmacy': return this.generatePharmacyPortal(user, hospitalState);
      case 'lab': return this.generateLabPortal(user, hospitalState);
      case 'billing': return this.generateBillingPortal(user, hospitalState);
      case 'admin': return this.generateAdminPortal(user, hospitalState);
      case 'patient': return this.generatePatientPortal(user, hospitalState);
      case 'it': return this.generateITPortal(user, hospitalState);
      default: return this.generateDefaultPortal(user);
    }
  }

  // === Nursing Portal (most complex — each nurse is unique) ===

  private static generateNursingPortal(user: UserIdentity, state: HospitalState): PortalView {
    const shift = user.shiftContext;
    const patients = shift?.assignedPatients ?? [];
    const myPatients = state.patients.filter((p) => patients.includes(p.id));
    const criticalPatient = myPatients.find((p) => p.acuityScore >= 8);

    // Shift phase determines primary focus
    let primaryWidgets: Widget[] = [];
    let urgentBanner: UrgentBanner | undefined;

    // URGENT: Any patient deteriorating?
    if (criticalPatient) {
      urgentBanner = {
        severity: 'critical',
        message: `${criticalPatient.name} (Rm ${criticalPatient.room}) — Acuity ${criticalPatient.acuityScore} — Immediate attention required`,
        action: { label: 'Open Chart', icon: '🚨', action: `/nurse/patient/${criticalPatient.id}/chart` },
        patientId: criticalPatient.id,
      };
    }

    if (shift?.shiftPhase === 'arriving' || shift?.shiftPhase === 'handoff_in') {
      // SHIFT START: Handoff report is most important
      primaryWidgets = [
        { id: 'handoff', type: 'handoff_report', title: 'Incoming Handoff', priority: 1, data: null, refreshInterval: 0 },
        { id: 'my_patients', type: 'patient_list', title: 'My Patients', priority: 2, data: myPatients, refreshInterval: 30 },
        { id: 'tasks', type: 'task_queue', title: 'Immediate Tasks', priority: 3, data: null, refreshInterval: 15 },
      ];
    } else if (shift?.shiftPhase === 'handoff_out') {
      // SHIFT END: Generate handoff
      primaryWidgets = [
        { id: 'handoff_gen', type: 'handoff_report', title: 'Generate Handoff Report', priority: 1, data: null, refreshInterval: 0 },
        { id: 'shift_stats', type: 'shift_stats', title: 'Shift Summary', priority: 2, data: null, refreshInterval: 0 },
        { id: 'pending', type: 'task_queue', title: 'Unfinished Tasks', priority: 3, data: null, refreshInterval: 0 },
      ];
    } else {
      // ACTIVE SHIFT: Tasks and patient monitoring
      primaryWidgets = [
        { id: 'tasks', type: 'task_queue', title: 'My Task Queue', priority: 1, data: null, refreshInterval: 15 },
        { id: 'alerts', type: 'alert_feed', title: 'Active Alerts', priority: 2, data: null, refreshInterval: 5 },
        { id: 'meds_due', type: 'medication_due', title: 'Medications Due', priority: 3, data: null, refreshInterval: 30 },
      ];
    }

    // Secondary: always visible but below fold
    const secondaryWidgets: Widget[] = [
      { id: 'my_patients', type: 'patient_list', title: 'My Patients', priority: 10, data: myPatients, refreshInterval: 30 },
      { id: 'vitals', type: 'vital_signs', title: 'Recent Vitals', priority: 11, data: null, refreshInterval: 15 },
    ];

    // Quick actions depend on specialization
    const quickActions: QuickAction[] = [
      { label: 'Record Vitals', icon: '💓', action: '/nurse/patient/:id/vitals' },
      { label: 'Scan Medication', icon: '💊', action: '/nurse/patient/:id/medication/scan' },
      { label: 'Start Recording', icon: '🎙️', action: '/nurse/scribe/start' },
      { label: 'Acknowledge Alert', icon: '✓', action: '/nurse/alerts/:id/acknowledge' },
    ];

    // ICU nurses get additional quick actions
    if (user.role === 'rn_icu') {
      quickActions.push(
        { label: 'Ventilator Check', icon: '🫁', action: '/nurse/patient/:id/assessment', params: { type: 'ventilator' } },
        { label: 'Hemodynamics', icon: '📊', action: '/nurse/patient/:id/vitals', params: { type: 'hemodynamic' } },
      );
    }

    // Cardiac nurses get different additions
    if (user.role === 'rn_cardiac') {
      quickActions.push(
        { label: 'Rhythm Strip', icon: '📈', action: '/nurse/patient/:id/assessment', params: { type: 'cardiac_rhythm' } },
        { label: 'Telemetry Review', icon: '🫀', action: '/nurse/patient/:id/telemetry' },
      );
    }

    // Break reminder
    if (shift && shift.hoursWorked >= 4 && shift.breaksTaken < 1) {
      secondaryWidgets.unshift({
        id: 'break_reminder', type: 'alert_feed', title: '⚠️ Break Overdue',
        priority: 5, data: { message: `${shift.hoursWorked}h worked, ${shift.breaksTaken} breaks taken` }, refreshInterval: 0,
      });
    }

    return {
      user,
      urgentBanner,
      primaryWidgets,
      secondaryWidgets,
      quickActions,
      contextualNav: [
        { label: 'Tasks', icon: '📋', route: '/nurse/tasks', badge: myPatients.reduce((s, p) => s + (p.pendingTaskCount ?? 0), 0) },
        { label: 'Patients', icon: '🛏️', route: '/nurse/patients' },
        { label: 'Alerts', icon: '🔔', route: '/nurse/alerts', badge: myPatients.reduce((s, p) => s + (p.activeAlertCount ?? 0), 0) },
        { label: 'Handoff', icon: '🤝', route: '/nurse/handoff' },
        { label: 'Meds', icon: '💊', route: '/nurse/medications' },
      ],
    };
  }

  // === Physician Portal ===

  private static generatePhysicianPortal(user: UserIdentity, state: HospitalState): PortalView {
    const myPatients = state.patients.filter(
      (p) => p.attendingPhysician === user.walletPubkey || p.activeGrants?.includes(user.walletPubkey)
    );
    const criticalResults = state.pendingCriticalResults?.filter(
      (r) => myPatients.some((p) => p.id === r.patientId)
    ) ?? [];

    let urgentBanner: UrgentBanner | undefined;
    if (criticalResults.length > 0) {
      urgentBanner = {
        severity: 'critical',
        message: `${criticalResults.length} critical lab result(s) pending review`,
        action: { label: 'Review Results', icon: '🔬', action: '/doctor/results/critical' },
      };
    }

    return {
      user,
      urgentBanner,
      primaryWidgets: [
        { id: 'my_patients', type: 'patient_list', title: 'My Patients', priority: 1, data: myPatients, refreshInterval: 30 },
        { id: 'results', type: 'lab_results', title: 'Pending Results', priority: 2, data: criticalResults, refreshInterval: 60 },
        { id: 'orders', type: 'order_queue', title: 'Active Orders', priority: 3, data: null, refreshInterval: 60 },
      ],
      secondaryWidgets: [
        { id: 'scribe', type: 'scribe_recorder', title: 'MediScribe', priority: 10, data: null, refreshInterval: 0 },
        { id: 'schedule', type: 'schedule', title: "Today's Schedule", priority: 11, data: null, refreshInterval: 300 },
      ],
      quickActions: [
        { label: 'Start Recording', icon: '🎙️', action: '/doctor/scribe/start' },
        { label: 'New Order', icon: '📝', action: '/doctor/orders' },
        { label: 'Review Labs', icon: '🔬', action: '/doctor/results' },
        { label: 'Sign Notes', icon: '✍️', action: '/doctor/notes/pending' },
      ],
      contextualNav: [
        { label: 'Patients', icon: '🩺', route: '/doctor/patients' },
        { label: 'Orders', icon: '📋', route: '/doctor/orders' },
        { label: 'Results', icon: '🔬', route: '/doctor/results', badge: criticalResults.length },
        { label: 'Notes', icon: '📄', route: '/doctor/notes' },
        { label: 'Schedule', icon: '📅', route: '/doctor/schedule' },
      ],
    };
  }

  // === Front Desk Portal ===

  private static generateFrontlinePortal(user: UserIdentity, state: HospitalState): PortalView {
    return {
      user,
      primaryWidgets: [
        { id: 'checkin', type: 'checkin_queue', title: 'Check-In Queue', priority: 1, data: state.checkinQueue, refreshInterval: 10 },
        { id: 'schedule', type: 'schedule', title: "Today's Appointments", priority: 2, data: null, refreshInterval: 60 },
        { id: 'beds', type: 'bed_board', title: 'Bed Availability', priority: 3, data: null, refreshInterval: 30 },
      ],
      secondaryWidgets: [
        { id: 'wait_times', type: 'acuity_overview', title: 'Current Wait Times', priority: 10, data: null, refreshInterval: 60 },
      ],
      quickActions: [
        { label: 'New Patient', icon: '➕', action: '/frontdesk/register' },
        { label: 'Check In', icon: '✓', action: '/frontdesk/checkin' },
        { label: 'Verify Insurance', icon: '🏥', action: '/frontdesk/insurance/verify' },
        { label: 'Schedule Appt', icon: '📅', action: '/frontdesk/schedule' },
      ],
      contextualNav: [
        { label: 'Queue', icon: '👥', route: '/frontdesk/queue', badge: state.checkinQueue?.length },
        { label: 'Schedule', icon: '📅', route: '/frontdesk/schedule' },
        { label: 'Register', icon: '➕', route: '/frontdesk/register' },
        { label: 'Beds', icon: '🛏️', route: '/frontdesk/beds' },
      ],
    };
  }

  // === Pharmacy Portal ===

  private static generatePharmacyPortal(user: UserIdentity, state: HospitalState): PortalView {
    const pendingOrders = state.pendingRxOrders ?? [];
    const criticalInteractions = pendingOrders.filter((o) => o.hasCriticalInteraction);

    return {
      user,
      urgentBanner: criticalInteractions.length > 0 ? {
        severity: 'critical',
        message: `${criticalInteractions.length} order(s) with critical drug interactions`,
        action: { label: 'Review Interactions', icon: '⚠️', action: '/pharmacy/interactions' },
      } : undefined,
      primaryWidgets: [
        { id: 'orders', type: 'dispense_queue', title: 'Pending Orders', priority: 1, data: pendingOrders, refreshInterval: 15 },
        { id: 'interactions', type: 'interaction_checker', title: 'Interaction Alerts', priority: 2, data: criticalInteractions, refreshInterval: 15 },
      ],
      secondaryWidgets: [
        { id: 'inventory', type: 'order_queue', title: 'Low Stock Alerts', priority: 10, data: null, refreshInterval: 300 },
      ],
      quickActions: [
        { label: 'Verify Order', icon: '✓', action: '/pharmacy/orders/:id/verify' },
        { label: 'Check Interactions', icon: '⚠️', action: '/pharmacy/interaction-check' },
        { label: 'Dispense', icon: '💊', action: '/pharmacy/dispense' },
      ],
      contextualNav: [
        { label: 'Orders', icon: '📋', route: '/pharmacy/orders', badge: pendingOrders.length },
        { label: 'Interactions', icon: '⚠️', route: '/pharmacy/interactions', badge: criticalInteractions.length },
        { label: 'Inventory', icon: '📦', route: '/pharmacy/inventory' },
      ],
    };
  }

  // === Lab Portal ===

  private static generateLabPortal(user: UserIdentity, state: HospitalState): PortalView {
    return {
      user,
      primaryWidgets: [
        { id: 'pending', type: 'specimen_tracker', title: 'Pending Specimens', priority: 1, data: null, refreshInterval: 15 },
        { id: 'orders', type: 'order_queue', title: 'New Lab Orders', priority: 2, data: null, refreshInterval: 30 },
        { id: 'results', type: 'lab_results', title: 'Results to Finalize', priority: 3, data: null, refreshInterval: 30 },
      ],
      secondaryWidgets: [],
      quickActions: [
        { label: 'Enter Result', icon: '🔬', action: '/lab/orders/:id/result' },
        { label: 'Register Specimen', icon: '🧪', action: '/lab/specimens' },
        { label: 'Critical Value', icon: '🚨', action: '/lab/critical-value', requiresConfirm: true },
      ],
      contextualNav: [
        { label: 'Specimens', icon: '🧪', route: '/lab/specimens' },
        { label: 'Orders', icon: '📋', route: '/lab/orders' },
        { label: 'Results', icon: '📊', route: '/lab/results' },
      ],
    };
  }

  // === Billing Portal ===

  private static generateBillingPortal(user: UserIdentity, state: HospitalState): PortalView {
    return {
      user,
      primaryWidgets: [
        { id: 'coding', type: 'coding_queue', title: 'Encounters to Code', priority: 1, data: null, refreshInterval: 60 },
        { id: 'claims', type: 'claims_status', title: 'Claims Pipeline', priority: 2, data: null, refreshInterval: 120 },
      ],
      secondaryWidgets: [
        { id: 'denials', type: 'claims_status', title: 'Denials to Appeal', priority: 10, data: null, refreshInterval: 300 },
      ],
      quickActions: [
        { label: 'Code Encounter', icon: '📝', action: '/billing/code' },
        { label: 'Submit Claim', icon: '📤', action: '/billing/claims/:id/submit' },
        { label: 'ZK Verify', icon: '🔐', action: '/billing/zkproof/verify' },
      ],
      contextualNav: [
        { label: 'Coding', icon: '📝', route: '/billing/coding' },
        { label: 'Claims', icon: '📄', route: '/billing/claims' },
        { label: 'Denials', icon: '❌', route: '/billing/denials' },
      ],
    };
  }

  // === Admin Portal ===

  private static generateAdminPortal(user: UserIdentity, state: HospitalState): PortalView {
    return {
      user,
      primaryWidgets: [
        { id: 'overview', type: 'acuity_overview', title: 'Hospital Overview', priority: 1, data: null, refreshInterval: 15 },
        { id: 'beds', type: 'bed_board', title: 'Bed Management', priority: 2, data: null, refreshInterval: 30 },
        { id: 'staffing', type: 'nurse_workload_map', title: 'Staffing & Workload', priority: 3, data: null, refreshInterval: 30 },
      ],
      secondaryWidgets: [
        { id: 'compliance', type: 'compliance_dashboard', title: 'Compliance Dashboard', priority: 10, data: null, refreshInterval: 300 },
        { id: 'blockchain', type: 'blockchain_status', title: 'Blockchain Health', priority: 11, data: null, refreshInterval: 60 },
      ],
      quickActions: [
        { label: 'Break Glass', icon: '🔓', action: '/admin/breakglass', requiresConfirm: true },
        { label: 'Export Audit', icon: '📊', action: '/admin/compliance/export' },
        { label: 'Adjust Staffing', icon: '👩‍⚕️', action: '/admin/staffing' },
      ],
      contextualNav: [
        { label: 'Overview', icon: '🏥', route: '/admin/dashboard' },
        { label: 'Staffing', icon: '👥', route: '/admin/staffing' },
        { label: 'Beds', icon: '🛏️', route: '/admin/beds' },
        { label: 'Compliance', icon: '📋', route: '/admin/compliance' },
        { label: 'System', icon: '⚙️', route: '/admin/system' },
      ],
    };
  }

  // === Patient Portal ===

  private static generatePatientPortal(user: UserIdentity, state: HospitalState): PortalView {
    return {
      user,
      primaryWidgets: [
        { id: 'records', type: 'patient_chart', title: 'My Health Records', priority: 1, data: null, refreshInterval: 60 },
        { id: 'grants', type: 'patient_list', title: 'Who Has Access', priority: 2, data: null, refreshInterval: 60 },
        { id: 'consent', type: 'patient_list', title: 'My Consents', priority: 3, data: null, refreshInterval: 60 },
      ],
      secondaryWidgets: [
        { id: 'audit', type: 'patient_list', title: 'Access History', priority: 10, data: null, refreshInterval: 120 },
        { id: 'blockchain', type: 'blockchain_status', title: 'My Blockchain Records', priority: 11, data: null, refreshInterval: 120 },
      ],
      quickActions: [
        { label: 'Grant Access', icon: '🔑', action: '/patient/grants' },
        { label: 'Revoke Access', icon: '🚫', action: '/patient/grants/:id/revoke', requiresConfirm: true },
        { label: 'Export Records', icon: '📥', action: '/patient/records/export' },
        { label: 'View Audit Trail', icon: '👁️', action: '/patient/audit' },
      ],
      contextualNav: [
        { label: 'Records', icon: '📄', route: '/patient/records' },
        { label: 'Access', icon: '🔑', route: '/patient/grants' },
        { label: 'Consent', icon: '✓', route: '/patient/consent' },
        { label: 'History', icon: '👁️', route: '/patient/audit' },
      ],
    };
  }

  // === IT/Security Portal ===

  private static generateITPortal(user: UserIdentity, _state: HospitalState): PortalView {
    return {
      user,
      primaryWidgets: [
        { id: 'system', type: 'system_health', title: 'System Health', priority: 1, data: null, refreshInterval: 10 },
        { id: 'blockchain', type: 'blockchain_status', title: 'Solana Network', priority: 2, data: null, refreshInterval: 15 },
        { id: 'audit', type: 'compliance_dashboard', title: 'Security Audit Feed', priority: 3, data: null, refreshInterval: 15 },
      ],
      secondaryWidgets: [
        { id: 'keys', type: 'system_health', title: 'Key Management', priority: 10, data: null, refreshInterval: 60 },
      ],
      quickActions: [
        { label: 'Rotate Keys', icon: '🔄', action: '/admin/keys/rotate', requiresConfirm: true },
        { label: 'Breach Report', icon: '🚨', action: '/admin/security/breach-report' },
        { label: 'Export Logs', icon: '📊', action: '/admin/audit/export' },
      ],
      contextualNav: [
        { label: 'Health', icon: '💚', route: '/admin/system/health' },
        { label: 'Blockchain', icon: '⛓️', route: '/admin/blockchain' },
        { label: 'Security', icon: '🔒', route: '/admin/security' },
        { label: 'Audit', icon: '📋', route: '/admin/audit' },
      ],
    };
  }

  private static generateDefaultPortal(user: UserIdentity): PortalView {
    return {
      user,
      primaryWidgets: [],
      secondaryWidgets: [],
      quickActions: [],
      contextualNav: [],
    };
  }

  // === Helpers ===

  private static getRoleGroup(role: UserRole): string {
    const nursing = ['rn_icu', 'rn_medsurg', 'rn_er', 'rn_peds', 'rn_oncology', 'rn_cardiac', 'rn_surgical', 'lpn', 'cna', 'charge_nurse', 'nurse_manager'];
    const physician = ['attending_physician', 'resident', 'specialist', 'surgeon'];
    const frontline = ['front_desk', 'registration'];
    const pharmacy = ['pharmacist', 'pharmacy_tech'];
    const lab = ['lab_tech', 'radiology_tech'];
    const billing = ['billing_coder', 'billing_specialist'];
    const admin = ['hospital_admin', 'department_director', 'cmo', 'cno'];
    const allied = ['respiratory_therapist', 'physical_therapist', 'social_worker', 'case_manager'];

    if (nursing.includes(role)) return 'nursing';
    if (physician.includes(role)) return 'physician';
    if (frontline.includes(role)) return 'frontline';
    if (pharmacy.includes(role)) return 'pharmacy';
    if (lab.includes(role)) return 'lab';
    if (billing.includes(role)) return 'billing';
    if (admin.includes(role)) return 'admin';
    if (role === 'patient') return 'patient';
    if (role === 'it_security') return 'it';
    if (allied.includes(role)) return 'allied';
    return 'default';
  }
}

// === Hospital State (fed into portal generation) ===

export interface HospitalState {
  patients: Array<{
    id: string;
    name: string;
    room: string;
    acuityScore: number;
    assignedNurse?: string;
    attendingPhysician?: string;
    activeGrants?: string[];
    pendingTaskCount?: number;
    activeAlertCount?: number;
  }>;
  checkinQueue?: Array<{ patientName: string; appointmentTime: string; status: string }>;
  pendingCriticalResults?: Array<{ patientId: string; testName: string; urgency: string }>;
  pendingRxOrders?: Array<{ orderId: string; medication: string; patientId: string; hasCriticalInteraction: boolean }>;
}
