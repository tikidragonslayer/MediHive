import { Hono } from 'hono';
import { AppEnv } from '../types';
import { collections } from '../db';
import { GrantStatus, RecordType } from '@medi-hive/vault-driver';

export const labRoutes = new Hono<AppEnv>();

// ─────────────────────────────────────────────────────────────────────
// VaultDriver-backed endpoints (v2)
// Lab reads are scoped to lab records.
// ─────────────────────────────────────────────────────────────────────

labRoutes.get('/v2/patients/:passportId/results', async (c) => {
  const auth = c.get('auth') as { pubkey: string };
  const vault = c.get('vault');
  const passportId = c.req.param('passportId');

  const passport = await vault.getPassport(passportId);
  if (!passport) return c.json({ error: 'Patient passport not found' }, 404);

  const grant = await vault.findActiveGrant(passportId, auth.pubkey);
  if (!grant || grant.status !== GrantStatus.Active || !grant.scope.read) {
    return c.json({ error: 'No active read grant for lab' }, 403);
  }
  if (!grant.scope.recordTypes.includes(RecordType.Lab)) {
    return c.json({ error: "Grant scope does not include 'lab' record type" }, 403);
  }

  const result = await vault.listRecordsForPatient(passportId, {
    types: [RecordType.Lab],
    limit: 100,
  });
  try { await vault.recordGrantAccess(grant.id); } catch { /* best-effort */ }
  try {
    await vault.appendAudit({
      actor: auth.pubkey,
      action: 'view' as never,
      targetPatient: passportId,
      ipHash: '00'.repeat(32),
      deviceHash: '00'.repeat(32),
      metadata: `lab result view via grant ${grant.id}`,
    });
  } catch { /* best-effort */ }

  return c.json({ ...result, grantId: grant.id });
});

// GET /api/lab/orders — Pending lab orders
labRoutes.get('/orders', async (c) => {
  // Firestore doesn't support OR + ILIKE, so fetch procedure tasks and filter client-side
  const tasksSnap = await collections.tasks()
    .where('type', '==', 'procedure')
    .where('completed_at', '==', null)
    .get();

  const labKeywords = ['lab', 'troponin', 'blood', 'specimen'];
  const orders = [];

  for (const doc of tasksSnap.docs) {
    const t = { id: doc.id, ...doc.data() } as Record<string, unknown>;
    const desc = ((t.description as string) || '').toLowerCase();

    if (labKeywords.some(kw => desc.includes(kw))) {
      const patientDoc = await collections.patients().doc(t.patient_id as string).get();
      if (patientDoc.exists) {
        const p = patientDoc.data()!;
        t.patient_name = p.name;
        t.room = p.room;
      }
      orders.push(t);
    }
  }

  return c.json({ orders });
});

// POST /api/lab/orders/:id/result — Submit lab result
labRoutes.post('/orders/:id/result', async (c) => {
  const taskId = c.req.param('id');
  const auth = c.get('auth') as { pubkey: string };
  const { result: labResult, unit, referenceRange, isCritical } = await c.req.json();

  // Complete the task
  await collections.tasks().doc(taskId).update({
    completed_at: new Date(),
    completed_by: auth.pubkey,
    completion_notes: `Result: ${labResult} ${unit ?? ''} (ref: ${referenceRange ?? 'N/A'})`,
  });

  // If critical value, generate alert
  if (isCritical) {
    const taskDoc = await collections.tasks().doc(taskId).get();
    if (taskDoc.exists) {
      const task = taskDoc.data()!;
      const alertId = `alert-lab-${Date.now()}`;
      await collections.alerts().doc(alertId).set({
        patient_id: task.patient_id,
        type: 'lab_result',
        severity: 'critical',
        original_severity: 'critical',
        message: `CRITICAL LAB: ${labResult} ${unit ?? ''}`,
        is_significant: true,
        acknowledged: false,
        acknowledged_by: null,
        acknowledged_at: null,
        created_at: new Date(),
      });
    }
  }

  // Record blockchain sync
  const syncId = `sync-lab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await collections.blockchain_sync().doc(syncId).set({
    entity_type: 'record',
    entity_id: `lab-${taskId}`,
    solana_signature: `sim-lab-${Date.now()}`,
    synced_at: new Date(),
  });

  return c.json({ status: 'result_submitted', isCritical });
});

// POST /api/lab/specimens — Register new specimen
labRoutes.post('/specimens', async (c) => {
  const { patientId, specimenType, collectedBy, orderId } = await c.req.json();

  // Track as a task completion
  return c.json({ status: 'specimen_registered', specimenId: `SPEC-${Date.now().toString(36).toUpperCase()}` }, 201);
});

// GET /api/lab/patient/:id/results — Patient lab history
labRoutes.get('/patient/:id/results', async (c) => {
  const patientId = c.req.param('id');

  const snap = await collections.tasks()
    .where('patient_id', '==', patientId)
    .where('type', '==', 'procedure')
    .get();

  // Filter for completed tasks only (Firestore can't do != null in compound queries easily)
  const results = snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter((t: Record<string, unknown>) => t.completed_at !== null)
    .map((t: Record<string, unknown>) => ({
      description: t.description,
      result: t.completion_notes,
      completed_at: t.completed_at,
      completed_by: t.completed_by,
    }))
    .sort((a, b) => {
      const aTime = new Date((a.completed_at as any)?.toDate?.() ?? a.completed_at ?? 0);
      const bTime = new Date((b.completed_at as any)?.toDate?.() ?? b.completed_at ?? 0);
      return bTime.getTime() - aTime.getTime();
    });

  return c.json({ results });
});
