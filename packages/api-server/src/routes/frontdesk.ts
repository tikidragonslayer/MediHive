import { Hono } from 'hono';
import { AppEnv } from '../types';
import { collections } from '../db';

export const frontdeskRoutes = new Hono<AppEnv>();

// ─────────────────────────────────────────────────────────────────────
// VaultDriver-backed endpoints (v2)
//
// Frontdesk has 'passport:basic' permission. This endpoint returns
// only public passport metadata — no records, no audit. Used at
// check-in to verify a real, active passport.
// ─────────────────────────────────────────────────────────────────────

frontdeskRoutes.get('/v2/passport/:passportId', async (c) => {
  const auth = c.get('auth') as { pubkey: string; permissions: string[] };
  const vault = c.get('vault');
  const passportId = c.req.param('passportId');

  if (!auth.permissions.includes('passport:basic')) {
    return c.json({ error: 'Forbidden: requires passport:basic permission' }, 403);
  }

  const passport = await vault.getPassport(passportId);
  if (!passport) return c.json({ error: 'Passport not found' }, 404);

  return c.json({
    passport: {
      id: passport.id,
      status: passport.status,
      recoveryThreshold: passport.recoveryThreshold,
      guardianCount: passport.guardians.length,
      emergencyHospitalShard: passport.emergencyHospitalShard,
      createdAt: passport.createdAt,
    },
  });
});

// POST /api/frontdesk/checkin — Process patient check-in
frontdeskRoutes.post('/checkin', async (c) => {
  const { patientId, appointmentId } = await c.req.json();

  if (appointmentId) {
    await collections.appointments().doc(appointmentId).update({ status: 'checked_in' });
  }

  if (patientId) {
    await collections.patients().doc(patientId).update({ status: 'admitted', updated_at: new Date() });
  }

  return c.json({ status: 'checked_in' });
});

// POST /api/frontdesk/register — Register new patient
frontdeskRoutes.post('/register', async (c) => {
  const { name, mrn, dob, insuranceId } = await c.req.json();
  if (!name) return c.json({ error: 'name required' }, 400);

  const id = `P-${Date.now()}`;
  const generatedMrn = mrn ?? `MRN-${Date.now().toString(36).toUpperCase()}`;

  await collections.patients().doc(id).set({
    name,
    mrn: generatedMrn,
    status: 'registered',
    created_at: new Date(),
    updated_at: new Date(),
  });

  return c.json({ patientId: id, mrn: generatedMrn, status: 'registered' }, 201);
});

// GET /api/frontdesk/patient/lookup — Search patient
frontdeskRoutes.get('/patient/lookup', async (c) => {
  const name = c.req.query('name');
  const mrn = c.req.query('mrn');

  let patients: Array<Record<string, unknown>> = [];
  if (mrn) {
    const snap = await collections.patients().where('mrn', '==', mrn).get();
    patients = snap.docs.map(d => {
      const data = d.data();
      return { id: d.id, name: data.name, mrn: data.mrn, room: data.room, status: data.status };
    });
  } else if (name) {
    // Firestore doesn't support ILIKE; fetch all and filter client-side
    // In production, use a search index (Algolia, Typesense, etc.)
    const snap = await collections.patients().get();
    const lowerName = name.toLowerCase();
    patients = snap.docs
      .map(d => {
        const data = d.data();
        return { id: d.id, name: data.name, mrn: data.mrn, room: data.room, status: data.status };
      })
      .filter(p => (p.name as string)?.toLowerCase().includes(lowerName))
      .slice(0, 20);
  } else {
    return c.json({ error: 'Provide name or mrn query parameter' }, 400);
  }

  return c.json({ patients });
});

// POST /api/frontdesk/schedule — Schedule appointment
frontdeskRoutes.post('/schedule', async (c) => {
  const { patientName, patientId, providerName, department, appointmentTime, durationMinutes, reason } = await c.req.json();

  const apptId = `appt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  await collections.appointments().doc(apptId).set({
    patient_id: patientId,
    patient_name: patientName,
    provider_name: providerName,
    department,
    appointment_time: new Date(appointmentTime),
    duration_minutes: durationMinutes ?? 30,
    reason,
    status: 'scheduled',
    created_at: new Date(),
  });

  return c.json({ status: 'scheduled' }, 201);
});

// GET /api/frontdesk/schedule — View today's schedule
frontdeskRoutes.get('/schedule', async (c) => {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date();
  todayEnd.setHours(23, 59, 59, 999);

  const snap = await collections.appointments()
    .where('appointment_time', '>=', todayStart)
    .where('appointment_time', '<=', todayEnd)
    .orderBy('appointment_time')
    .get();

  const appointments = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  return c.json({ appointments });
});

// POST /api/frontdesk/insurance/verify — Verify insurance
frontdeskRoutes.post('/insurance/verify', async (c) => {
  const { patientId, insuranceId } = await c.req.json();

  if (!patientId) {
    return c.json({ error: 'patientId is required' }, 400);
  }

  // Look up patient in Firestore
  const patientDoc = await collections.patients().doc(patientId).get();
  if (!patientDoc.exists) {
    return c.json({ error: 'Patient not found' }, 404);
  }

  const patient = patientDoc.data()!;

  // Check if insurance info exists on the patient record
  const storedInsuranceId = patient.insurance_id ?? patient.insuranceId;
  if (!storedInsuranceId) {
    return c.json({
      verified: false,
      patientId,
      reason: 'No insurance information on file for this patient',
    });
  }

  // Validate insurance ID format (alphanumeric, 6-20 characters, optional dashes)
  const insuranceIdToCheck = insuranceId ?? storedInsuranceId;
  const insuranceIdRegex = /^[A-Za-z0-9\-]{6,20}$/;
  if (!insuranceIdRegex.test(insuranceIdToCheck)) {
    return c.json({
      verified: false,
      patientId,
      insuranceId: insuranceIdToCheck,
      reason: 'Invalid insurance ID format',
    });
  }

  // If caller provided an insuranceId, verify it matches the record
  if (insuranceId && storedInsuranceId !== insuranceId) {
    return c.json({
      verified: false,
      patientId,
      insuranceId,
      reason: 'Insurance ID does not match patient record',
    });
  }

  return c.json({
    verified: true,
    patientId,
    insuranceId: storedInsuranceId,
    coverage: {
      provider: patient.insurance_provider ?? patient.insuranceProvider ?? 'Unknown',
      planType: patient.insurance_plan_type ?? patient.insurancePlanType ?? 'Unknown',
      groupNumber: patient.insurance_group ?? patient.insuranceGroup ?? null,
      effectiveDate: patient.insurance_effective_date ?? null,
      expirationDate: patient.insurance_expiration_date ?? null,
    },
  });
});
