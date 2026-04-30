import { Hono } from 'hono';
import { AppEnv } from '../types';
import { collections } from '../db';
import { GrantStatus, RecordType } from '@medi-hive/vault-driver';

export const nurseRoutes = new Hono<AppEnv>();

// ─────────────────────────────────────────────────────────────────────
// VaultDriver-backed endpoints (v2)
//
// Nurses read records on the same active-grant model as doctors but
// typically with narrower scope (vital + medication record types).
// Authorization decisions live in the driver.
// ─────────────────────────────────────────────────────────────────────

nurseRoutes.get('/v2/patients/:passportId/records', async (c) => {
  const auth = c.get('auth') as { pubkey: string };
  const vault = c.get('vault');
  const passportId = c.req.param('passportId');

  const passport = await vault.getPassport(passportId);
  if (!passport) return c.json({ error: 'Patient passport not found' }, 404);

  const grant = await vault.findActiveGrant(passportId, auth.pubkey);
  if (!grant || grant.status !== GrantStatus.Active || !grant.scope.read) {
    return c.json({ error: 'No active read grant for this nurse' }, 403);
  }

  const url = new URL(c.req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 500);
  const requested = (url.searchParams.get('types') ?? 'vital,prescription,note')
    .split(',')
    .filter((t) => Object.values(RecordType).includes(t as RecordType)) as RecordType[];
  const types = requested.filter((t) => grant.scope.recordTypes.includes(t));
  if (types.length === 0) {
    return c.json({ records: [], hint: "Requested types are outside the grant's scope." });
  }

  const result = await vault.listRecordsForPatient(passportId, { limit, types });
  try { await vault.recordGrantAccess(grant.id); } catch { /* best-effort */ }
  try {
    await vault.appendAudit({
      actor: auth.pubkey,
      action: 'view' as never,
      targetPatient: passportId,
      ipHash: '00'.repeat(32),
      deviceHash: '00'.repeat(32),
      metadata: `nurse view via grant ${grant.id}`,
    });
  } catch { /* best-effort */ }

  return c.json({ ...result, grantId: grant.id });
});

// GET /api/nurse/tasks — Optimized task queue for this nurse
nurseRoutes.get('/tasks', async (c) => {
  const auth = c.get('auth') as { pubkey: string };

  const snap = await collections.tasks()
    .where('assigned_nurse', '==', auth.pubkey)
    .where('completed_at', '==', null)
    .get();

  const tasks = [];
  for (const doc of snap.docs) {
    const t = { id: doc.id, ...doc.data() } as Record<string, unknown>;

    const patientDoc = await collections.patients().doc(t.patient_id as string).get();
    if (patientDoc.exists) {
      const p = patientDoc.data()!;
      t.patient_name = p.name;
      t.room = p.room;
      t.floor = p.floor;
      t.acuity_score = p.acuity_score;
    }

    tasks.push(t);
  }

  // Sort by priority then scheduled_time
  const priorityOrder: Record<string, number> = { critical: 0, urgent: 1, routine: 2 };
  tasks.sort((a, b) => {
    const pa = priorityOrder[a.priority as string] ?? 3;
    const pb = priorityOrder[b.priority as string] ?? 3;
    if (pa !== pb) return pa - pb;
    const aTime = (a.scheduled_time as any)?.toDate?.()?.getTime?.() ?? 0;
    const bTime = (b.scheduled_time as any)?.toDate?.()?.getTime?.() ?? 0;
    return aTime - bTime;
  });

  return c.json({ tasks, count: tasks.length });
});

// PUT /api/nurse/tasks/:id/complete — Mark task as done
nurseRoutes.put('/tasks/:id/complete', async (c) => {
  const taskId = c.req.param('id');
  const auth = c.get('auth') as { pubkey: string };
  const body = await c.req.json().catch(() => ({}));

  await collections.tasks().doc(taskId).update({
    completed_at: new Date(),
    completed_by: auth.pubkey,
    completion_notes: body.notes ?? null,
    follow_up_required: body.followUpRequired ?? false,
    follow_up_reason: body.followUpReason ?? null,
  });

  return c.json({ status: 'completed' });
});

// POST /api/nurse/patient/:id/vitals — Record vital signs
nurseRoutes.post('/patient/:id/vitals', async (c) => {
  const patientId = c.req.param('id');
  const auth = c.get('auth') as { pubkey: string };
  const v = await c.req.json();

  const vitalId = `vital-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await collections.vitals().doc(vitalId).set({
    patient_id: patientId,
    nurse_pubkey: auth.pubkey,
    heart_rate: v.heartRate,
    systolic_bp: v.systolicBP,
    diastolic_bp: v.diastolicBP,
    temperature: v.temperature,
    respiratory_rate: v.respiratoryRate,
    spo2: v.spO2,
    pain_level: v.painLevel,
    assessment_notes: v.notes,
    recorded_at: new Date(),
  });

  // Update patient acuity score based on new vitals
  // Simplified NEWS2 calculation
  let news = 0;
  if (v.heartRate) {
    if (v.heartRate <= 40 || v.heartRate >= 131) news += 3;
    else if (v.heartRate <= 50 || v.heartRate >= 111) news += 1;
    else if (v.heartRate >= 91) news += 1;
  }
  if (v.systolicBP) {
    if (v.systolicBP <= 90 || v.systolicBP >= 220) news += 3;
    else if (v.systolicBP <= 100) news += 2;
    else if (v.systolicBP <= 110) news += 1;
  }
  if (v.spO2) {
    if (v.spO2 <= 91) news += 3;
    else if (v.spO2 <= 93) news += 2;
    else if (v.spO2 <= 95) news += 1;
  }
  const acuity = Math.min(10, Math.round((news / 4) * 10 + 2) / 10 * 3);

  await collections.patients().doc(patientId).update({ acuity_score: acuity, updated_at: new Date() });

  // Auto-generate alerts for concerning values
  const alerts: Array<{ type: string; severity: string; message: string }> = [];
  if (v.heartRate && (v.heartRate > 120 || v.heartRate < 50)) {
    alerts.push({ type: 'vital_sign', severity: v.heartRate > 140 || v.heartRate < 40 ? 'critical' : 'high', message: `HR ${v.heartRate} bpm` });
  }
  if (v.systolicBP && v.systolicBP < 90) {
    alerts.push({ type: 'vital_sign', severity: 'critical', message: `SBP ${v.systolicBP} mmHg — hypotension` });
  }
  if (v.spO2 && v.spO2 < 92) {
    alerts.push({ type: 'vital_sign', severity: v.spO2 < 88 ? 'critical' : 'high', message: `SpO2 ${v.spO2}%` });
  }
  if (v.temperature && v.temperature > 39.0) {
    alerts.push({ type: 'vital_sign', severity: 'high', message: `Temp ${v.temperature}°C — high fever` });
  }

  for (const alert of alerts) {
    const alertId = `alert-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    await collections.alerts().doc(alertId).set({
      patient_id: patientId,
      type: alert.type,
      severity: alert.severity,
      original_severity: alert.severity,
      message: alert.message,
      is_significant: true,
      acknowledged: false,
      acknowledged_by: null,
      acknowledged_at: null,
      created_at: new Date(),
    });
  }

  return c.json({ status: 'vitals_recorded', acuityScore: acuity, alertsGenerated: alerts.length });
});

// GET /api/nurse/patient/:id/vitals — Vitals trend
nurseRoutes.get('/patient/:id/vitals', async (c) => {
  const patientId = c.req.param('id');
  const snap = await collections.vitals()
    .where('patient_id', '==', patientId)
    .orderBy('recorded_at', 'desc')
    .limit(48)
    .get();
  const vitals = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return c.json({ vitals });
});

// POST /api/nurse/patient/:id/medication/scan — BCMA scan verification
nurseRoutes.post('/patient/:id/medication/scan', async (c) => {
  const patientId = c.req.param('id');
  const { barcode, orderedMedication, orderedDose, orderedRoute, scheduledTime } = await c.req.json();

  // Get current medications for interaction check
  const currentMedsSnap = await collections.medication_admin()
    .where('patient_id', '==', patientId)
    .orderBy('administered_at', 'desc')
    .limit(20)
    .get();

  const warnings: string[] = [];
  let verified = true;

  // Right medication check
  if (barcode && orderedMedication && !barcode.toLowerCase().includes(orderedMedication.toLowerCase())) {
    warnings.push(`WRONG MEDICATION: Scanned "${barcode}" does not match ordered "${orderedMedication}"`);
    verified = false;
  }

  // Right time check (1-hour window)
  if (scheduledTime) {
    const scheduled = new Date(scheduledTime).getTime();
    const diff = Math.abs(Date.now() - scheduled);
    if (diff > 3600000) {
      warnings.push(`OUTSIDE TIME WINDOW: ${Math.round(diff / 60000)} minutes from scheduled time`);
      verified = false;
    }
  }

  return c.json({ verified, warnings, patientId, medication: orderedMedication });
});

// POST /api/nurse/patient/:id/medication/administer — Record medication admin
nurseRoutes.post('/patient/:id/medication/administer', async (c) => {
  const patientId = c.req.param('id');
  const auth = c.get('auth') as { pubkey: string };
  const { medication, dose, route, site, bcmaVerified, response } = await c.req.json();

  const medId = `med-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await collections.medication_admin().doc(medId).set({
    patient_id: patientId,
    nurse_pubkey: auth.pubkey,
    medication,
    dose,
    route,
    site,
    bcma_verified: bcmaVerified ?? false,
    patient_response: response,
    administered_at: new Date(),
  });

  return c.json({ status: 'administered' });
});

// GET /api/nurse/alerts — Triaged alerts for assigned patients
nurseRoutes.get('/alerts', async (c) => {
  const auth = c.get('auth') as { pubkey: string };

  // Get patients assigned to this nurse
  const patientsSnap = await collections.patients()
    .where('assigned_nurse', '==', auth.pubkey)
    .get();

  const patientIds = patientsSnap.docs.map(d => d.id);
  if (patientIds.length === 0) return c.json({ alerts: [] });

  // Get unacknowledged significant alerts for these patients
  const alerts: Array<Record<string, unknown>> = [];
  // Firestore 'in' queries limited to 30 items
  for (let i = 0; i < patientIds.length; i += 30) {
    const chunk = patientIds.slice(i, i + 30);
    const alertsSnap = await collections.alerts()
      .where('patient_id', 'in', chunk)
      .where('acknowledged', '==', false)
      .where('is_significant', '==', true)
      .get();

    for (const doc of alertsSnap.docs) {
      const a = { id: doc.id, ...doc.data() } as Record<string, unknown>;
      const patientDoc = patientsSnap.docs.find(p => p.id === a.patient_id);
      if (patientDoc) {
        const p = patientDoc.data();
        a.patient_name = p.name;
        a.room = p.room;
        a.acuity_score = p.acuity_score;
      }
      alerts.push(a);
    }
  }

  // Sort by severity
  const severityOrder: Record<string, number> = { critical: 0, high: 1, medium: 2 };
  alerts.sort((a, b) => (severityOrder[a.severity as string] ?? 3) - (severityOrder[b.severity as string] ?? 3));

  return c.json({ alerts });
});

// PUT /api/nurse/alerts/:id/acknowledge — Acknowledge alert
nurseRoutes.put('/alerts/:id/acknowledge', async (c) => {
  const alertId = c.req.param('id');
  const auth = c.get('auth') as { pubkey: string };

  await collections.alerts().doc(alertId).update({
    acknowledged: true,
    acknowledged_by: auth.pubkey,
    acknowledged_at: new Date(),
  });

  return c.json({ status: 'acknowledged' });
});

// POST /api/nurse/handoff/generate — Generate end-of-shift handoff
nurseRoutes.post('/handoff/generate', async (c) => {
  const auth = c.get('auth') as { pubkey: string };

  const patientsSnap = await collections.patients()
    .where('assigned_nurse', '==', auth.pubkey)
    .where('status', '==', 'admitted')
    .get();

  const handoff = [];
  for (const doc of patientsSnap.docs) {
    const p = doc.data();

    // Recent vitals (last 3)
    const vitalsSnap = await collections.vitals()
      .where('patient_id', '==', doc.id)
      .orderBy('recorded_at', 'desc')
      .limit(3)
      .get();
    const recentVitals = vitalsSnap.docs.map(v => {
      const vd = v.data();
      return { hr: vd.heart_rate, bp: `${vd.systolic_bp}/${vd.diastolic_bp}`, spo2: vd.spo2, time: vd.recorded_at };
    });

    // Pending tasks
    const tasksSnap = await collections.tasks()
      .where('patient_id', '==', doc.id)
      .where('completed_at', '==', null)
      .get();
    const pendingTasks = tasksSnap.docs.map(t => {
      const td = t.data();
      return { desc: td.description, priority: td.priority, scheduled: td.scheduled_time };
    });

    // Active alerts
    const alertsSnap = await collections.alerts()
      .where('patient_id', '==', doc.id)
      .where('acknowledged', '==', false)
      .get();
    const activeAlerts = alertsSnap.docs.map(a => {
      const ad = a.data();
      return { msg: ad.message, severity: ad.severity };
    });

    handoff.push({
      patientId: doc.id,
      name: p.name,
      room: p.room,
      acuity: p.acuity_score,
      diagnosis: p.primary_diagnosis,
      recentVitals: recentVitals.length > 0 ? recentVitals : null,
      pendingTasks: pendingTasks.length > 0 ? pendingTasks : null,
      activeAlerts: activeAlerts.length > 0 ? activeAlerts : null,
    });
  }

  return c.json({ handoff, generatedAt: new Date().toISOString(), nurseId: auth.pubkey });
});

// GET /api/nurse/patient/:id/chart — View patient chart (via grant)
nurseRoutes.get('/patient/:id/chart', async (c) => {
  const patientId = c.req.param('id');

  const [patientDoc, vitalsSnap, tasksSnap] = await Promise.all([
    collections.patients().doc(patientId).get(),
    collections.vitals().where('patient_id', '==', patientId).orderBy('recorded_at', 'desc').limit(12).get(),
    collections.tasks().where('patient_id', '==', patientId).where('completed_at', '==', null).orderBy('scheduled_time').get(),
  ]);

  if (!patientDoc.exists) return c.json({ error: 'Patient not found' }, 404);

  return c.json({
    patient: { id: patientDoc.id, ...patientDoc.data() },
    vitals: vitalsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    tasks: tasksSnap.docs.map(d => ({ id: d.id, ...d.data() })),
  });
});
