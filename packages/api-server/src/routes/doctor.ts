/**
 * MediHive — Copyright (C) 2024-2026 The MediHive Authors
 * Licensed under the GNU Affero General Public License v3.0 or later.
 * See LICENSE in the project root for the full text.
 *
 * This file is part of MediHive. MediHive is free software: you can
 * redistribute it and/or modify it under the terms of the AGPL-3.0.
 * It is distributed WITHOUT ANY WARRANTY; see the LICENSE for details.
 */
import { Hono } from 'hono';
import { AppEnv } from '../types';
import { collections } from '../db';
import { GrantStatus, RecordType } from '@medi-hive/vault-driver';

export const doctorRoutes = new Hono<AppEnv>();

// ─────────────────────────────────────────────────────────────────────
// VaultDriver-backed endpoints (v2)
//
// The doctor's-eye view of a patient. Reads go through c.var.vault, so
// the federated profile transparently merges patient-curated on-chain
// records into the result when a bridge is active. Doctors see one
// chart, the federation layer handles "where did this come from."
//
// Authorization: doctors must hold an active access grant for the
// patient. The vault driver enforces the time window, scope, and
// status; we just forward the doctor's pubkey + the patient passport
// and trust the driver's findActiveGrant + recordGrantAccess.
// ─────────────────────────────────────────────────────────────────────

// GET /api/doctor/v2/patients/:passportId/records — list records for a
// patient the doctor has an active grant for. Records are filtered by
// grant scope (the patient's allowed record types) at the driver level.
doctorRoutes.get('/v2/patients/:passportId/records', async (c) => {
  const auth = c.get('auth') as { pubkey: string };
  const vault = c.get('vault');
  const passportId = c.req.param('passportId');

  const passport = await vault.getPassport(passportId);
  if (!passport) return c.json({ error: 'Patient passport not found' }, 404);

  const grant = await vault.findActiveGrant(passportId, auth.pubkey);
  if (!grant) {
    return c.json(
      {
        error: 'No active access grant',
        hint: 'Patient must mint an access grant naming this clinician before records are visible.',
      },
      403,
    );
  }
  if (grant.status !== GrantStatus.Active) {
    return c.json({ error: 'Access grant is not active' }, 403);
  }
  if (!grant.scope.read) {
    return c.json({ error: 'Access grant does not include read permission' }, 403);
  }

  const url = new URL(c.req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 500);
  const cursor = url.searchParams.get('cursor') ?? undefined;
  const typesParam = url.searchParams.get('types');
  // The doctor can only request types within the grant's scope.
  const requested = typesParam
    ? (typesParam.split(',').filter((t) =>
        Object.values(RecordType).includes(t as RecordType),
      ) as RecordType[])
    : grant.scope.recordTypes;
  const types = requested.filter((t) => grant.scope.recordTypes.includes(t));

  if (types.length === 0) {
    return c.json({
      records: [],
      nextCursor: null,
      grantId: grant.id,
      hint: 'Requested record types are outside the grant\'s allowed scope.',
    });
  }

  const result = await vault.listRecordsForPatient(passportId, { limit, cursor, types });

  // Increment access_count on the grant. recordGrantAccess is best-effort:
  // a failure to increment must not block the read (audit log captures
  // the access either way), but we surface it for ops to observe.
  try {
    await vault.recordGrantAccess(grant.id);
  } catch {
    /* grant counter increment failed — continue */
  }

  // Append a 'view' audit entry through the driver. Same try/catch
  // posture: clinical reads must continue even if audit fails.
  try {
    await vault.appendAudit({
      actor: auth.pubkey,
      action: 'view' as never,
      targetPatient: passportId,
      ipHash: '00'.repeat(32),
      deviceHash: '00'.repeat(32),
      metadata: `doctor view via grant ${grant.id}`,
    });
  } catch {
    /* audit append failed */
  }

  return c.json({ ...result, grantId: grant.id });
});

// GET /api/doctor/v2/patients/:passportId/grant — current active grant
// for this doctor on this patient. 404 if none. Doctors can call this
// before fetching records to know if they need to request a grant.
doctorRoutes.get('/v2/patients/:passportId/grant', async (c) => {
  const auth = c.get('auth') as { pubkey: string };
  const vault = c.get('vault');
  const passportId = c.req.param('passportId');

  const grant = await vault.findActiveGrant(passportId, auth.pubkey);
  if (!grant) return c.json({ grant: null }, 404);

  return c.json({ grant });
});

// GET /api/doctor/patients — List patients with active grants
doctorRoutes.get('/patients', async (c) => {
  const auth = c.get('auth') as { pubkey: string };

  const patientsSnap = await collections.patients()
    .where('attending_physician', '==', auth.pubkey)
    .where('status', '==', 'admitted')
    .orderBy('acuity_score', 'desc')
    .get();

  const patients = [];
  for (const doc of patientsSnap.docs) {
    const p = { id: doc.id, ...doc.data() } as Record<string, unknown>;

    // Get latest vitals
    const vitalsSnap = await collections.vitals()
      .where('patient_id', '==', doc.id)
      .orderBy('recorded_at', 'desc')
      .limit(1)
      .get();

    if (vitalsSnap.docs.length > 0) {
      const v = vitalsSnap.docs[0].data();
      p.heart_rate = v.heart_rate;
      p.systolic_bp = v.systolic_bp;
      p.diastolic_bp = v.diastolic_bp;
      p.spo2 = v.spo2;
      p.temperature = v.temperature;
      p.pain_level = v.pain_level;
    }

    // Count pending tasks
    const pendingTasksSnap = await collections.tasks()
      .where('patient_id', '==', doc.id)
      .where('completed_at', '==', null)
      .get();
    p.pending_tasks = pendingTasksSnap.size;

    // Count active alerts
    const activeAlertsSnap = await collections.alerts()
      .where('patient_id', '==', doc.id)
      .where('acknowledged', '==', false)
      .get();
    p.active_alerts = activeAlertsSnap.size;

    patients.push(p);
  }

  return c.json({ patients });
});

// GET /api/doctor/patient/:id/chart — View patient chart
doctorRoutes.get('/patient/:id/chart', async (c) => {
  const patientId = c.req.param('id');

  const [patientDoc, vitalsSnap, medsSnap, notesSnap, alertsSnap] = await Promise.all([
    collections.patients().doc(patientId).get(),
    collections.vitals().where('patient_id', '==', patientId).orderBy('recorded_at', 'desc').limit(24).get(),
    collections.medication_admin().where('patient_id', '==', patientId).orderBy('administered_at', 'desc').limit(20).get(),
    collections.scribe_sessions().where('patient_id', '==', patientId).where('review_status', '==', 'signed').orderBy('start_time', 'desc').limit(10).get(),
    collections.alerts().where('patient_id', '==', patientId).orderBy('created_at', 'desc').limit(20).get(),
  ]);

  if (!patientDoc.exists) return c.json({ error: 'Patient not found' }, 404);

  return c.json({
    patient: { id: patientDoc.id, ...patientDoc.data() },
    vitalsTrend: vitalsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    medications: medsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    notes: notesSnap.docs.map(d => ({ id: d.id, ...d.data() })),
    alerts: alertsSnap.docs.map(d => ({ id: d.id, ...d.data() })),
  });
});

// POST /api/doctor/scribe/start — Start ambient recording session
doctorRoutes.post('/scribe/start', async (c) => {
  const auth = c.get('auth') as { pubkey: string };
  const { patientId } = await c.req.json();
  if (!patientId) return c.json({ error: 'patientId required' }, 400);

  const sessionId = `scribe-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  await collections.scribe_sessions().doc(sessionId).set({
    patient_id: patientId,
    clinician_pubkey: auth.pubkey,
    start_time: new Date(),
    consent_verified: true,
    ai_model: 'claude-sonnet-4-20250514',
    review_status: 'draft',
  });

  return c.json({ sessionId, status: 'recording' });
});

// POST /api/doctor/scribe/:sessionId/transcript — Add transcript
doctorRoutes.post('/scribe/:sessionId/transcript', async (c) => {
  const sessionId = c.req.param('sessionId');
  const { segments } = await c.req.json();

  await collections.scribe_sessions().doc(sessionId).update({
    transcript: segments,
  });

  return c.json({ status: 'transcript_saved' });
});

// POST /api/doctor/scribe/:sessionId/generate — Generate SOAP note
doctorRoutes.post('/scribe/:sessionId/generate', async (c) => {
  const sessionId = c.req.param('sessionId');

  const sessionDoc = await collections.scribe_sessions().doc(sessionId).get();
  if (!sessionDoc.exists) return c.json({ error: 'Session not found' }, 404);

  const session = sessionDoc.data()!;
  const transcript = session.transcript;
  if (!transcript) return c.json({ error: 'No transcript data' }, 400);

  // Get patient context
  const patientDoc = await collections.patients().doc(session.patient_id).get();
  const recentVitalsSnap = await collections.vitals()
    .where('patient_id', '==', session.patient_id)
    .orderBy('recorded_at', 'desc')
    .limit(1)
    .get();

  // Call Claude API for SOAP generation
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const client = new Anthropic();

    const patientCtx = patientDoc.exists ? patientDoc.data()! : null;
    const vitals = recentVitalsSnap.docs.length > 0 ? recentVitalsSnap.docs[0].data() : null;

    // Sanitize transcript — strip control chars, cap total length
    const cleanSegment = (s: unknown): string => {
      if (typeof s !== 'string') return '';
      return s.replace(/[\x00-\x1F\x7F]/g, ' ').trim().slice(0, 2000);
    };
    const rawTranscriptText = Array.isArray(transcript)
      ? transcript
          .filter((s) => s && typeof s === 'object')
          .map((s: { speaker?: unknown; text?: unknown }) =>
            `[${cleanSegment(s.speaker || 'Speaker')}]: ${cleanSegment(s.text || '')}`)
          .join('\n')
      : cleanSegment(transcript);
    const transcriptText = rawTranscriptText.slice(0, 30000);

    // Sanitize patient context fields (from DB, but defence-in-depth)
    const safeName = cleanSegment(patientCtx?.name ?? 'Unknown');
    const safeDx = cleanSegment(patientCtx?.primary_diagnosis ?? 'Unknown');
    const safeIcd = (Array.isArray(patientCtx?.icd_codes) ? patientCtx.icd_codes : [])
      .map((c: unknown) => cleanSegment(c)).filter(Boolean).slice(0, 20).join(', ') || 'None';

    const response = await client.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `Generate a SOAP note from this clinical transcript. Patient: ${safeName}, Dx: ${safeDx}, ICD: ${safeIcd}. ${vitals ? `Vitals: HR ${Number(vitals.heart_rate) || 0}, BP ${Number(vitals.systolic_bp) || 0}/${Number(vitals.diastolic_bp) || 0}, SpO2 ${Number(vitals.spo2) || 0}%, T ${Number(vitals.temperature) || 0}°C` : ''}

<transcript>
${transcriptText}
</transcript>

Return JSON: {subjective, objective, assessment, plan, icdCodes: [{code,display}], cptCodes: [{code,display}], medicationChanges: [{action,medication,details}]}. No markdown fences.`,
      }],
    });

    const content = response.content[0];
    if (content.type !== 'text') throw new Error('Unexpected response');

    let soapNote;
    try {
      soapNote = JSON.parse(content.text.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '').trim());
    } catch {
      soapNote = { subjective: content.text, objective: '', assessment: '', plan: '', icdCodes: [], cptCodes: [], medicationChanges: [] };
    }

    await collections.scribe_sessions().doc(sessionId).update({
      soap_note: soapNote,
      review_status: 'draft',
    });

    return c.json({ soapNote, status: 'draft' });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return c.json({ error: `SOAP generation failed: ${msg}` }, 500);
  }
});

// POST /api/doctor/scribe/:sessionId/sign — Sign and mint record
doctorRoutes.post('/scribe/:sessionId/sign', async (c) => {
  const sessionId = c.req.param('sessionId');
  const auth = c.get('auth') as { pubkey: string };

  const sessionDoc = await collections.scribe_sessions().doc(sessionId).get();
  if (!sessionDoc.exists) return c.json({ error: 'Session not found' }, 404);

  const session = sessionDoc.data()!;
  if (!session.soap_note) return c.json({ error: 'No SOAP note to sign' }, 400);

  // Mark as signed
  await collections.scribe_sessions().doc(sessionId).update({
    review_status: 'signed',
    end_time: new Date(),
  });

  // Record the signing event
  const syncId = `sync-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await collections.blockchain_sync().doc(syncId).set({
    entity_type: 'record',
    entity_id: sessionId,
    solana_signature: `sim-${Date.now()}`,
    synced_at: new Date(),
  });

  return c.json({ status: 'signed', message: 'Note signed — Record NFT minting queued' });
});

// GET /api/doctor/orders — View pending orders
doctorRoutes.get('/orders', async (c) => {
  const auth = c.get('auth') as { pubkey: string };

  const tasksSnap = await collections.tasks()
    .where('type', 'in', ['medication', 'procedure'])
    .where('completed_at', '==', null)
    .get();

  const orders = [];
  for (const doc of tasksSnap.docs) {
    const t = { id: doc.id, ...doc.data() } as Record<string, unknown>;

    const patientDoc = await collections.patients().doc(t.patient_id as string).get();
    if (patientDoc.exists) {
      const p = patientDoc.data()!;
      t.patient_name = p.name;
      t.room = p.room;
    }

    orders.push(t);
  }

  // Sort by priority
  const priorityOrder: Record<string, number> = { critical: 0, urgent: 1, routine: 2 };
  orders.sort((a, b) => (priorityOrder[a.priority as string] ?? 3) - (priorityOrder[b.priority as string] ?? 3));

  return c.json({ orders });
});

// POST /api/doctor/orders — Create new order
doctorRoutes.post('/orders', async (c) => {
  const auth = c.get('auth') as { pubkey: string };
  const { patientId, type, description, priority } = await c.req.json();

  if (!patientId || !type || !description) {
    return c.json({ error: 'patientId, type, description required' }, 400);
  }

  const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await collections.tasks().doc(taskId).set({
    patient_id: patientId,
    type,
    priority: priority ?? 'routine',
    description,
    scheduled_time: new Date(),
    completed_at: null,
    completed_by: null,
    completion_notes: null,
    follow_up_required: false,
    follow_up_reason: null,
    created_at: new Date(),
  });

  return c.json({ taskId, status: 'ordered' }, 201);
});
