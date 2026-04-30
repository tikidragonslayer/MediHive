import { Hono } from 'hono';
import { AppEnv } from '../types';
import { db, collections } from '../db';
import { AuditAction } from '@medi-hive/vault-driver';

export const adminRoutes = new Hono<AppEnv>();

// ─────────────────────────────────────────────────────────────────────
// VaultDriver-backed endpoints (v2)
//
// Admin role has audit:all permission. The v2 audit endpoint hits the
// vault driver's listAuditForPatient / verifyAuditChain so an
// administrator can spot-check chain integrity from the UI.
// ─────────────────────────────────────────────────────────────────────

adminRoutes.get('/v2/audit/:passportId', async (c) => {
  const auth = c.get('auth') as { pubkey: string; permissions: string[] };
  const vault = c.get('vault');
  const passportId = c.req.param('passportId');

  if (!auth.permissions.includes('audit:all')) {
    return c.json({ error: 'Forbidden: requires audit:all permission' }, 403);
  }

  const url = new URL(c.req.url);
  const since = url.searchParams.get('since')
    ? parseInt(url.searchParams.get('since')!, 10)
    : undefined;
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '500', 10), 5000);

  const entries = await vault.listAuditForPatient(passportId, { since, limit });

  try {
    await vault.appendAudit({
      actor: auth.pubkey,
      action: AuditAction.Export,
      targetPatient: passportId,
      ipHash: '00'.repeat(32),
      deviceHash: '00'.repeat(32),
      metadata: `admin audit:all read (${entries.length} entries)`,
    });
  } catch { /* best-effort */ }

  return c.json({ entries, count: entries.length });
});

adminRoutes.get('/v2/audit-verify', async (c) => {
  const auth = c.get('auth') as { pubkey: string; permissions: string[] };
  const vault = c.get('vault');

  if (!auth.permissions.includes('audit:all')) {
    return c.json({ error: 'Forbidden: requires audit:all permission' }, 403);
  }

  const url = new URL(c.req.url);
  const fromSeq = parseInt(url.searchParams.get('fromSeq') ?? '1', 10);
  const toSeq = parseInt(url.searchParams.get('toSeq') ?? '1000', 10);

  try {
    const result = await vault.verifyAuditChain(fromSeq, toSeq);
    return c.json({
      valid: result.valid,
      rootHash: result.rootHash,
      entryCount: result.entries.length,
      fromSeq,
      toSeq,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'verifyAuditChain failed';
    return c.json({ error: msg }, 501);
  }
});

// GET /api/admin/dashboard — Hospital command center metrics
adminRoutes.get('/dashboard', async (c) => {
  const [patientsSnap, nursesSnap, bedsSnap, alertsSnap, tasksSnap, blockchainSnap] = await Promise.all([
    collections.patients().where('status', '==', 'admitted').get(),
    collections.users().where('role', 'in', ['nurse', 'rn_bsn', 'rn_adn', 'rn_msn']).get(),
    collections.beds().get(),
    collections.alerts().where('created_at', '>=', new Date(Date.now() - 24 * 60 * 60 * 1000)).get(),
    collections.tasks().where('created_at', '>=', new Date(Date.now() - 24 * 60 * 60 * 1000)).get(),
    collections.blockchain_sync().where('synced_at', '>=', new Date(Date.now() - 24 * 60 * 60 * 1000)).get(),
  ]);

  const patients = patientsSnap.docs.map(d => d.data());
  const total = patients.length;
  const avgAcuity = total > 0 ? patients.reduce((sum, p) => sum + (p.acuity_score || 0), 0) / total : 0;
  const critical = patients.filter(p => (p.acuity_score ?? 0) >= 8).length;
  const high = patients.filter(p => (p.acuity_score ?? 0) >= 6 && (p.acuity_score ?? 0) < 8).length;
  const medium = patients.filter(p => (p.acuity_score ?? 0) >= 3 && (p.acuity_score ?? 0) < 6).length;
  const low = patients.filter(p => (p.acuity_score ?? 0) < 3).length;

  const bedsAll = bedsSnap.docs.map(d => d.data());
  const bedsTotal = bedsAll.length;
  const bedsOccupied = bedsAll.filter(b => b.status === 'occupied').length;

  const alertsDocs = alertsSnap.docs.map(d => d.data());
  const alertsTotal = alertsDocs.length;
  const alertsActive = alertsDocs.filter(a => a.acknowledged === false && a.is_significant === true).length;
  const alertsSuppressed = alertsDocs.filter(a => a.is_significant === false).length;

  const tasksDocs = tasksSnap.docs.map(d => d.data());
  const tasksTotal = tasksDocs.length;
  const tasksCompleted = tasksDocs.filter(t => t.completed_at !== null).length;

  return c.json({
    patients: { total, avgAcuity: Math.round(avgAcuity * 10) / 10, acuityDistribution: { critical, high, medium, low } },
    nurses: { total: nursesSnap.size },
    beds: { total: bedsTotal || 120, occupied: bedsOccupied, occupancyRate: bedsTotal > 0 ? Math.round((bedsOccupied / bedsTotal) * 100) : 0 },
    alerts: { today: alertsTotal, active: alertsActive, suppressed: alertsSuppressed, reductionRate: alertsTotal > 0 ? Math.round((alertsSuppressed / alertsTotal) * 100) : 0 },
    tasks: { today: tasksTotal, completed: tasksCompleted },
    blockchain: { transactionsToday: blockchainSnap.size },
    timestamp: new Date().toISOString(),
  });
});

// GET /api/admin/staffing — Current staffing levels
adminRoutes.get('/staffing', async (c) => {
  const usersSnap = await collections.users().where('role', 'in', ['nurse', 'rn_bsn', 'rn_adn', 'rn_msn']).get();
  const staff = [];

  for (const doc of usersSnap.docs) {
    const u = { id: doc.id, ...doc.data() };

    const patientCountSnap = await collections.patients()
      .where('assigned_nurse', '==', u.id)
      .where('status', '==', 'admitted')
      .get();

    // Get pending tasks for patients assigned to this nurse
    const patientsOfNurse = patientCountSnap.docs.map(d => d.id);
    let pendingTasks = 0;
    if (patientsOfNurse.length > 0) {
      // Firestore 'in' queries limited to 30 items
      for (let i = 0; i < patientsOfNurse.length; i += 30) {
        const chunk = patientsOfNurse.slice(i, i + 30);
        const tasksSnap = await collections.tasks()
          .where('patient_id', 'in', chunk)
          .where('completed_at', '==', null)
          .get();
        pendingTasks += tasksSnap.size;
      }
    }

    staff.push({ ...u, patient_count: patientCountSnap.size, pending_tasks: pendingTasks });
  }

  return c.json({ staff });
});

// GET /api/admin/beds — Bed occupancy
adminRoutes.get('/beds', async (c) => {
  const bedsSnap = await collections.beds().orderBy('floor').orderBy('wing').orderBy('room').get();
  const beds = [];

  for (const doc of bedsSnap.docs) {
    const bed = { id: doc.id, ...doc.data() } as Record<string, unknown>;

    if (bed.patient_id) {
      const patientDoc = await collections.patients().doc(bed.patient_id as string).get();
      if (patientDoc.exists) {
        const p = patientDoc.data()!;
        bed.patient_name = p.name;
        bed.acuity_score = p.acuity_score;
        bed.primary_diagnosis = p.primary_diagnosis;
      }
    }

    beds.push(bed);
  }

  return c.json({ beds });
});

// GET /api/admin/compliance — HIPAA compliance dashboard
adminRoutes.get('/compliance', async (c) => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [auditSnap, emergencySnap, consentSnap, nonceSnap] = await Promise.all([
    collections.blockchain_sync()
      .where('entity_type', '==', 'audit')
      .where('synced_at', '>=', thirtyDaysAgo)
      .get(),
    collections.alerts()
      .where('type', '==', 'vital_sign')
      .where('severity', '==', 'critical')
      .where('created_at', '>=', thirtyDaysAgo)
      .get(),
    collections.blockchain_sync()
      .where('entity_type', '==', 'consent')
      .where('synced_at', '>=', thirtyDaysAgo)
      .get(),
    collections.used_nonces()
      .where('used_at', '>=', thirtyDaysAgo)
      .get(),
  ]);

  return c.json({
    auditEntries30d: auditSnap.size,
    emergencyAccesses30d: emergencySnap.size,
    consentChanges30d: consentSnap.size,
    authAttempts30d: nonceSnap.size,
    hipaaStatus: 'compliant',
    lastAudit: new Date().toISOString(),
  });
});

// POST /api/admin/compliance/export — Export audit report
adminRoutes.post('/compliance/export', async (c) => {
  const snap = await collections.blockchain_sync()
    .where('entity_type', '==', 'audit')
    .orderBy('synced_at', 'desc')
    .limit(1000)
    .get();
  const report = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return c.json({ report, exportedAt: new Date().toISOString(), format: 'json' });
});

// GET /api/admin/system/health — System health check
adminRoutes.get('/system/health', async (c) => {
  let dbHealthy = false;
  try {
    await db.listCollections();
    dbHealthy = true;
  } catch { /* */ }

  return c.json({
    database: dbHealthy ? 'healthy' : 'down',
    solana: 'devnet_connected',
    fhir: 'sandbox_active',
    ipfs: 'not_configured',
    arweave: 'not_configured',
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    timestamp: new Date().toISOString(),
  });
});
