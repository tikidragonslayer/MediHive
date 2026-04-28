import { Hono } from 'hono';
import { AppEnv } from '../types';
import { collections } from '../db';

export const pharmacyRoutes = new Hono<AppEnv>();

// Curated interaction database (same as brain-engine/medication-checker.ts)
const INTERACTIONS: Array<{ drug1: string; drug2: string; severity: string; effect: string; recommendation: string }> = [
  { drug1: 'warfarin', drug2: 'aspirin', severity: 'major', effect: 'Increased bleeding risk', recommendation: 'Monitor INR closely' },
  { drug1: 'metoprolol', drug2: 'verapamil', severity: 'critical', effect: 'Severe bradycardia/heart block', recommendation: 'AVOID combination' },
  { drug1: 'morphine', drug2: 'lorazepam', severity: 'critical', effect: 'Respiratory depression', recommendation: 'FDA black box — avoid' },
  { drug1: 'fentanyl', drug2: 'midazolam', severity: 'critical', effect: 'Respiratory depression', recommendation: 'FDA black box — avoid' },
  { drug1: 'lisinopril', drug2: 'potassium', severity: 'major', effect: 'Hyperkalemia', recommendation: 'Monitor serum K+' },
  { drug1: 'ciprofloxacin', drug2: 'theophylline', severity: 'critical', effect: 'Theophylline toxicity (seizures)', recommendation: 'Reduce theophylline 50%' },
  { drug1: 'simvastatin', drug2: 'amiodarone', severity: 'major', effect: 'Rhabdomyolysis risk', recommendation: 'Limit simvastatin to 20mg/day' },
  { drug1: 'digoxin', drug2: 'amiodarone', severity: 'critical', effect: 'Digoxin toxicity (fatal arrhythmias)', recommendation: 'Reduce digoxin 50%' },
  { drug1: 'metformin', drug2: 'contrast', severity: 'critical', effect: 'Lactic acidosis', recommendation: 'Hold metformin 48h before/after contrast' },
];

// GET /api/pharmacy/orders — Pending prescription orders
pharmacyRoutes.get('/orders', async (c) => {
  const snap = await collections.tasks()
    .where('type', '==', 'medication')
    .where('completed_at', '==', null)
    .get();

  const orders = [];
  for (const doc of snap.docs) {
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
  const priorityOrder: Record<string, number> = { critical: 0, urgent: 1 };
  orders.sort((a, b) => (priorityOrder[a.priority as string] ?? 2) - (priorityOrder[b.priority as string] ?? 2));

  return c.json({ orders });
});

// POST /api/pharmacy/orders/:id/fill — Fill prescription
pharmacyRoutes.post('/orders/:id/fill', async (c) => {
  const taskId = c.req.param('id');
  const auth = c.get('auth') as { pubkey: string };

  await collections.tasks().doc(taskId).update({
    completed_at: new Date(),
    completed_by: auth.pubkey,
    completion_notes: 'Filled by pharmacy',
  });

  return c.json({ status: 'filled' });
});

// POST /api/pharmacy/interaction-check — Check drug-drug interactions
pharmacyRoutes.post('/interaction-check', async (c) => {
  const { medications } = await c.req.json();
  if (!Array.isArray(medications) || medications.length < 2) {
    return c.json({ error: 'Provide array of 2+ medication names' }, 400);
  }

  const normalized = medications.map((m: string) => m.toLowerCase().trim());
  const found: typeof INTERACTIONS = [];

  for (let i = 0; i < normalized.length; i++) {
    for (let j = i + 1; j < normalized.length; j++) {
      for (const ix of INTERACTIONS) {
        if (
          (normalized[i].includes(ix.drug1) && normalized[j].includes(ix.drug2)) ||
          (normalized[i].includes(ix.drug2) && normalized[j].includes(ix.drug1))
        ) {
          found.push({ ...ix, drug1: medications[i], drug2: medications[j] });
        }
      }
    }
  }

  const hasCritical = found.some((f) => f.severity === 'critical');

  return c.json({
    medications,
    interactions: found,
    hasCritical,
    summary: found.length === 0 ? 'No known interactions' : `${found.length} interaction(s) found${hasCritical ? ' — CRITICAL' : ''}`,
  });
});

// POST /api/pharmacy/dispense — Record medication dispensed
pharmacyRoutes.post('/dispense', async (c) => {
  const auth = c.get('auth') as { pubkey: string };
  const { patientId, medication, dose, route } = await c.req.json();

  const medId = `med-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await collections.medication_admin().doc(medId).set({
    patient_id: patientId,
    nurse_pubkey: auth.pubkey,
    medication,
    dose,
    route,
    bcma_verified: false,
    administered_at: new Date(),
  });

  return c.json({ status: 'dispensed' });
});

// GET /api/pharmacy/patient/:id/medications — Patient medication list
pharmacyRoutes.get('/patient/:id/medications', async (c) => {
  const patientId = c.req.param('id');
  const snap = await collections.medication_admin()
    .where('patient_id', '==', patientId)
    .orderBy('administered_at', 'desc')
    .get();
  const medications = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return c.json({ medications });
});
