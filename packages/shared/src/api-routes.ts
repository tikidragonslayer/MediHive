/**
 * MediHive API Route Definitions — Role-gated endpoints for each portal.
 *
 * Every endpoint requires wallet-signed authentication.
 * Access is verified against on-chain Access Grant NFTs.
 */

export const API_ROUTES = {
  // === Patient Portal ===
  patient: {
    // Onboarding
    'POST /patient/onboard': { role: ['patient', 'frontdesk'], perm: 'passport:create:own', desc: 'Create patient passport SBT' },
    'GET /patient/passport': { role: ['patient'], perm: 'passport:read:own', desc: 'View own passport details' },
    'PUT /patient/encryption-key': { role: ['patient'], perm: 'passport:update:own', desc: 'Rotate encryption key' },

    // Records
    'GET /patient/records': { role: ['patient'], perm: 'records:read:own', desc: 'List all own medical records' },
    'GET /patient/records/:id': { role: ['patient'], perm: 'records:read:own', desc: 'View specific record' },
    'POST /patient/records/export': { role: ['patient'], perm: 'records:export:own', desc: 'Export records as FHIR bundle' },

    // Access Grants
    'GET /patient/grants': { role: ['patient'], perm: 'grants:read:own', desc: 'List who has access to records' },
    'POST /patient/grants': { role: ['patient'], perm: 'grants:create:own', desc: 'Grant access to a clinician' },
    'DELETE /patient/grants/:id': { role: ['patient'], perm: 'grants:revoke:own', desc: 'Revoke access from a clinician' },

    // Consent
    'GET /patient/consent': { role: ['patient'], perm: 'consent:read:own', desc: 'View all consent records' },
    'POST /patient/consent': { role: ['patient'], perm: 'consent:create:own', desc: 'Record new consent' },
    'DELETE /patient/consent/:id': { role: ['patient'], perm: 'consent:revoke:own', desc: 'Revoke consent' },

    // Audit Trail
    'GET /patient/audit': { role: ['patient'], perm: 'audit:read:own', desc: 'View who accessed your records and when' },
  },

  // === Doctor Portal ===
  doctor: {
    'GET /doctor/patients': { role: ['doctor'], perm: 'records:read:granted', desc: 'List patients with active grants' },
    'GET /doctor/patient/:id/chart': { role: ['doctor'], perm: 'records:read:granted', desc: 'View patient chart (uses Access Grant NFT)' },
    'POST /doctor/patient/:id/note': { role: ['doctor'], perm: 'records:create:granted', desc: 'Create clinical note (mint Record NFT)' },
    'PUT /doctor/patient/:id/note/:noteId/amend': { role: ['doctor'], perm: 'records:amend:granted', desc: 'Amend existing note' },

    // MediScribe
    'POST /doctor/scribe/start': { role: ['doctor'], perm: 'scribe:record', desc: 'Start ambient recording session' },
    'POST /doctor/scribe/:sessionId/transcript': { role: ['doctor'], perm: 'scribe:record', desc: 'Add transcript segment' },
    'POST /doctor/scribe/:sessionId/generate': { role: ['doctor'], perm: 'scribe:record', desc: 'Generate SOAP note from transcript' },
    'POST /doctor/scribe/:sessionId/sign': { role: ['doctor'], perm: 'scribe:sign', desc: 'Sign and mint SOAP note as Record NFT' },

    // Orders
    'POST /doctor/orders': { role: ['doctor'], perm: 'orders:create', desc: 'Create lab/imaging/rx order' },
    'GET /doctor/orders': { role: ['doctor'], perm: 'orders:read', desc: 'View pending orders' },
  },

  // === Nurse Portal ===
  nurse: {
    // Task Queue
    'GET /nurse/tasks': { role: ['nurse'], perm: 'tasks:read:assigned', desc: 'Get optimized task queue' },
    'PUT /nurse/tasks/:id/complete': { role: ['nurse'], perm: 'tasks:complete', desc: 'Mark task as completed' },
    'PUT /nurse/tasks/:id/reassign': { role: ['nurse'], perm: 'tasks:reassign', desc: 'Reassign task to another nurse' },

    // Vitals
    'POST /nurse/patient/:id/vitals': { role: ['nurse'], perm: 'vitals:create', desc: 'Record vital signs' },
    'GET /nurse/patient/:id/vitals': { role: ['nurse'], perm: 'vitals:read:assigned', desc: 'View patient vitals history' },

    // Medication Admin
    'POST /nurse/patient/:id/medication/scan': { role: ['nurse'], perm: 'medications:verify', desc: 'BCMA scan — verify medication against order' },
    'POST /nurse/patient/:id/medication/administer': { role: ['nurse'], perm: 'medications:administer', desc: 'Record medication administration' },

    // MediScribe (nurses can also record)
    'POST /nurse/scribe/start': { role: ['nurse'], perm: 'scribe:record', desc: 'Start recording for assessment note' },
    'POST /nurse/scribe/:sessionId/sign': { role: ['nurse'], perm: 'scribe:sign', desc: 'Sign assessment note' },

    // Handoff
    'GET /nurse/handoff': { role: ['nurse'], perm: 'handoff:read', desc: 'View incoming handoff report' },
    'POST /nurse/handoff/generate': { role: ['nurse'], perm: 'handoff:generate', desc: 'Generate end-of-shift handoff' },

    // Alerts
    'GET /nurse/alerts': { role: ['nurse'], perm: 'alerts:read:assigned', desc: 'View triaged alerts for assigned patients' },
    'PUT /nurse/alerts/:id/acknowledge': { role: ['nurse'], perm: 'alerts:acknowledge', desc: 'Acknowledge alert' },

    // Chart access (via grant)
    'GET /nurse/patient/:id/chart': { role: ['nurse'], perm: 'records:read:granted', desc: 'View patient chart' },
    'POST /nurse/patient/:id/note': { role: ['nurse'], perm: 'records:create:granted', desc: 'Create nursing note' },
  },

  // === Admin Portal ===
  admin: {
    'GET /admin/dashboard': { role: ['admin'], perm: 'dashboard:read', desc: 'Hospital command center metrics' },
    'GET /admin/staffing': { role: ['admin'], perm: 'staffing:read', desc: 'View current staffing levels' },
    'PUT /admin/staffing': { role: ['admin'], perm: 'staffing:update', desc: 'Adjust staffing assignments' },
    'GET /admin/beds': { role: ['admin'], perm: 'beds:read', desc: 'Bed occupancy and turnover' },
    'GET /admin/compliance': { role: ['admin'], perm: 'compliance:read', desc: 'HIPAA compliance dashboard' },
    'POST /admin/compliance/export': { role: ['admin'], perm: 'compliance:export', desc: 'Export audit report' },
    'GET /admin/audit': { role: ['admin'], perm: 'audit:read:all', desc: 'Full audit trail (all patients)' },
    'POST /admin/breakglass': { role: ['admin'], perm: 'breakglass:authorize', desc: 'Authorize break-glass emergency access' },
    'GET /admin/system/health': { role: ['admin'], perm: 'system:health', desc: 'System health (Solana, IPFS, EHR connectivity)' },
  },

  // === Front Desk Portal ===
  frontdesk: {
    'POST /frontdesk/checkin': { role: ['frontdesk'], perm: 'checkin:process', desc: 'Process patient check-in' },
    'POST /frontdesk/register': { role: ['frontdesk'], perm: 'passport:create:new', desc: 'Register new patient (create passport)' },
    'GET /frontdesk/patient/lookup': { role: ['frontdesk'], perm: 'passport:read:basic', desc: 'Search patient by MRN/name/DOB (no clinical data)' },
    'POST /frontdesk/insurance/verify': { role: ['frontdesk'], perm: 'insurance:verify', desc: 'Verify insurance eligibility' },
    'POST /frontdesk/schedule': { role: ['frontdesk'], perm: 'scheduling:create', desc: 'Schedule appointment' },
    'GET /frontdesk/schedule': { role: ['frontdesk'], perm: 'scheduling:read', desc: 'View appointment schedule' },
  },

  // === Pharmacy Portal ===
  pharmacy: {
    'GET /pharmacy/orders': { role: ['pharmacy'], perm: 'orders:read:rx', desc: 'View pending prescription orders' },
    'POST /pharmacy/orders/:id/fill': { role: ['pharmacy'], perm: 'orders:fill', desc: 'Fill prescription order' },
    'POST /pharmacy/interaction-check': { role: ['pharmacy'], perm: 'medications:interaction_check', desc: 'Check drug-drug interactions' },
    'POST /pharmacy/dispense': { role: ['pharmacy'], perm: 'medications:dispense', desc: 'Record medication dispensed' },
    'GET /pharmacy/patient/:id/medications': { role: ['pharmacy'], perm: 'records:read:medication', desc: 'View patient medication list' },
  },

  // === Lab Portal ===
  lab: {
    'GET /lab/orders': { role: ['lab'], perm: 'orders:read:lab', desc: 'View pending lab orders' },
    'POST /lab/orders/:id/result': { role: ['lab'], perm: 'orders:complete:lab', desc: 'Submit lab result (mints Record NFT)' },
    'POST /lab/specimens': { role: ['lab'], perm: 'specimens:create', desc: 'Register new specimen' },
    'PUT /lab/specimens/:id/status': { role: ['lab'], perm: 'specimens:track', desc: 'Update specimen status' },
    'GET /lab/patient/:id/results': { role: ['lab'], perm: 'records:read:lab', desc: 'View patient lab history' },
  },

  // === Billing Portal ===
  billing: {
    'GET /billing/patient/:id/codes': { role: ['billing'], perm: 'records:read:billing', desc: 'View ICD-10/CPT codes (no clinical data)' },
    'POST /billing/claims': { role: ['billing'], perm: 'claims:create', desc: 'Create insurance claim' },
    'GET /billing/claims': { role: ['billing'], perm: 'claims:read', desc: 'View claims status' },
    'POST /billing/claims/:id/submit': { role: ['billing'], perm: 'claims:submit', desc: 'Submit claim to payer' },
    'POST /billing/zkproof/verify': { role: ['billing'], perm: 'zkproof:verify', desc: 'Verify ZK proof for insurance eligibility' },
  },
} as const;
