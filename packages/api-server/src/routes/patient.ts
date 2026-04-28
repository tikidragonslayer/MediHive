import { Hono } from 'hono';
import { AppEnv } from '../types';
import { collections } from '../db';
import { requirePermission } from '../middleware/auth';

export const patientRoutes = new Hono<AppEnv>();

// GET /api/patient/passport — View own passport
patientRoutes.get('/passport', async (c) => {
  const auth = c.get('auth') as { pubkey: string };
  const snap = await collections.patients().where('wallet_pubkey', '==', auth.pubkey).get();
  if (snap.empty) return c.json({ error: 'Passport not found' }, 404);
  const doc = snap.docs[0];
  return c.json({ id: doc.id, ...doc.data() });
});

// POST /api/patient/onboard — Create patient passport
patientRoutes.post('/onboard', async (c) => {
  const auth = c.get('auth') as { pubkey: string };
  const body = await c.req.json();
  const { name, mrn, dob } = body;

  if (!name || !mrn) return c.json({ error: 'name and mrn required' }, 400);

  // Check if patient already exists with this wallet
  const existing = await collections.patients().where('wallet_pubkey', '==', auth.pubkey).get();
  if (!existing.empty) {
    return c.json({ patient: { id: existing.docs[0].id, ...existing.docs[0].data() }, message: 'Passport already exists' }, 200);
  }

  const id = `P-${Date.now()}`;
  const patientData = {
    wallet_pubkey: auth.pubkey,
    name,
    mrn,
    status: 'registered',
    created_at: new Date(),
    updated_at: new Date(),
  };

  await collections.patients().doc(id).set(patientData);

  return c.json({ patient: { id, ...patientData }, message: 'Passport created — SBT minting pending' }, 201);
});

// GET /api/patient/records — List own medical records
patientRoutes.get('/records', async (c) => {
  const auth = c.get('auth') as { pubkey: string };
  const patientSnap = await collections.patients().where('wallet_pubkey', '==', auth.pubkey).get();
  if (patientSnap.empty) return c.json({ error: 'Patient not found' }, 404);

  const patientId = patientSnap.docs[0].id;

  const recordsSnap = await collections.scribe_sessions()
    .where('patient_id', '==', patientId)
    .where('review_status', '==', 'signed')
    .orderBy('start_time', 'desc')
    .get();

  const records = recordsSnap.docs.map(d => {
    const data = d.data();
    return {
      id: d.id,
      soap_note: data.soap_note,
      review_status: data.review_status,
      start_time: data.start_time,
      record_nft_tx: data.record_nft_tx,
    };
  });

  return c.json({ records });
});

// GET /api/patient/grants — List who has access
patientRoutes.get('/grants', async (c) => {
  const auth = c.get('auth') as { pubkey: string };

  const grantsSnap = await collections.blockchain_sync()
    .where('entity_type', '==', 'grant')
    .orderBy('synced_at', 'desc')
    .get();

  const grants = [];
  for (const doc of grantsSnap.docs) {
    const g = { id: doc.id, ...doc.data() } as Record<string, unknown>;

    // Try to resolve grantee info
    if (g.entity_id) {
      const userDoc = await collections.users().where('wallet_pubkey', '==', g.entity_id).get();
      if (!userDoc.empty) {
        const u = userDoc.docs[0].data();
        g.grantee_name = u.name;
        g.grantee_role = u.role;
      }
    }

    grants.push(g);
  }

  return c.json({ grants });
});

// GET /api/patient/consent — View consent records
patientRoutes.get('/consent', async (c) => {
  const auth = c.get('auth') as { pubkey: string };
  const snap = await collections.blockchain_sync()
    .where('entity_type', '==', 'consent')
    .orderBy('synced_at', 'desc')
    .get();
  const consents = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return c.json({ consents });
});

// GET /api/patient/audit — Who accessed my records
patientRoutes.get('/audit', async (c) => {
  const auth = c.get('auth') as { pubkey: string };
  const patientSnap = await collections.patients().where('wallet_pubkey', '==', auth.pubkey).get();
  if (patientSnap.empty) return c.json({ error: 'Patient not found' }, 404);

  const patientId = patientSnap.docs[0].id;

  // Gather access history from multiple collections
  const [sessionsSnap, vitalsSnap, medsSnap] = await Promise.all([
    collections.scribe_sessions().where('patient_id', '==', patientId).get(),
    collections.vitals().where('patient_id', '==', patientId).get(),
    collections.medication_admin().where('patient_id', '==', patientId).get(),
  ]);

  const auditTrail: Array<{ action: string; actor: string; timestamp: unknown }> = [];

  for (const d of sessionsSnap.docs) {
    const data = d.data();
    auditTrail.push({ action: 'chart_view', actor: data.clinician_pubkey, timestamp: data.start_time });
  }
  for (const d of vitalsSnap.docs) {
    const data = d.data();
    auditTrail.push({ action: 'vitals_recorded', actor: data.nurse_pubkey, timestamp: data.recorded_at });
  }
  for (const d of medsSnap.docs) {
    const data = d.data();
    auditTrail.push({ action: 'medication_administered', actor: data.nurse_pubkey, timestamp: data.administered_at });
  }

  // Sort by timestamp descending, limit to 50
  auditTrail.sort((a, b) => {
    const aTime = (a.timestamp as any)?.toDate?.()?.getTime?.() ?? new Date(a.timestamp as string).getTime();
    const bTime = (b.timestamp as any)?.toDate?.()?.getTime?.() ?? new Date(b.timestamp as string).getTime();
    return bTime - aTime;
  });

  return c.json({ auditTrail: auditTrail.slice(0, 50) });
});
