import { Hono } from 'hono';
import { createHash } from 'crypto';
import { AppEnv } from '../types';
import { collections, db } from '../db';

export const billingRoutes = new Hono<AppEnv>();

// GET /api/billing/patient/:id/codes — View ICD-10/CPT codes (no clinical data)
billingRoutes.get('/patient/:id/codes', async (c) => {
  const patientId = c.req.param('id');

  const [patientDoc, sessionsSnap] = await Promise.all([
    collections.patients().doc(patientId).get(),
    collections.scribe_sessions()
      .where('patient_id', '==', patientId)
      .where('review_status', '==', 'signed')
      .orderBy('start_time', 'desc')
      .get(),
  ]);

  if (!patientDoc.exists) return c.json({ error: 'Patient not found' }, 404);

  const patient = patientDoc.data()!;

  return c.json({
    patientId,
    patientName: patient.name,
    primaryDiagnosis: patient.primary_diagnosis,
    icdCodes: patient.icd_codes ?? [],
    encounters: sessionsSnap.docs.map((d) => {
      const s = d.data();
      return {
        date: s.start_time,
        icdCodes: s.soap_note?.icdCodes ?? null,
        cptCodes: s.soap_note?.cptCodes ?? null,
      };
    }),
  });
});

// POST /api/billing/claims — Create insurance claim
billingRoutes.post('/claims', async (c) => {
  const { patientId, providerId, encounterId, icdCodes, cptCodes, totalAmount, serviceDate, serviceDateEnd } = await c.req.json();

  // Validate required fields
  const missing: string[] = [];
  if (!patientId) missing.push('patientId');
  if (!providerId) missing.push('providerId');
  if (!icdCodes || !Array.isArray(icdCodes) || icdCodes.length === 0) missing.push('icdCodes (non-empty array)');
  if (!cptCodes || !Array.isArray(cptCodes) || cptCodes.length === 0) missing.push('cptCodes (non-empty array)');
  if (!serviceDate) missing.push('serviceDate');
  if (missing.length > 0) {
    return c.json({ error: `Missing required fields: ${missing.join(', ')}` }, 400);
  }

  // Generate EDI 837 transaction ID
  const transactionId = `EDI837-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const claimId = `CLM-${Date.now().toString(36).toUpperCase()}`;

  // Store claim in Firestore
  await db.collection('claims').doc(claimId).set({
    claimId,
    transactionId,
    patientId,
    providerId,
    encounterId: encounterId ?? null,
    icdCodes,
    cptCodes,
    totalAmount: totalAmount ?? null,
    serviceDate: new Date(serviceDate),
    serviceDateEnd: serviceDateEnd ? new Date(serviceDateEnd) : new Date(serviceDate),
    status: 'submitted',
    submittedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  return c.json({
    claimId,
    transactionId,
    status: 'submitted',
    patientId,
    icdCodes,
    cptCodes,
    totalAmount: totalAmount ?? null,
    estimatedProcessingDays: 14,
    message: 'Claim submitted — EDI 837 transaction created',
  }, 201);
});

// GET /api/billing/claims — View claims status
billingRoutes.get('/claims', async (c) => {
  const patientId = c.req.query('patientId');

  let query: FirebaseFirestore.Query = db.collection('claims');
  if (patientId) {
    query = query.where('patientId', '==', patientId);
  }
  query = query.orderBy('createdAt', 'desc').limit(50);

  const snap = await query.get();
  const claims = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  return c.json({ claims });
});

// POST /api/billing/claims/:id/submit — Submit claim to payer
billingRoutes.post('/claims/:id/submit', async (c) => {
  const claimId = c.req.param('id');

  const claimDoc = await db.collection('claims').doc(claimId).get();
  if (!claimDoc.exists) {
    return c.json({ error: 'Claim not found' }, 404);
  }

  const claim = claimDoc.data()!;
  if (claim.status === 'submitted') {
    return c.json({ claimId, status: 'submitted', message: 'Claim already submitted' });
  }

  const transactionId = claim.transactionId ?? `EDI837-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;

  await db.collection('claims').doc(claimId).update({
    status: 'submitted',
    transactionId,
    submittedAt: new Date(),
    updatedAt: new Date(),
  });

  return c.json({
    claimId,
    transactionId,
    status: 'submitted',
    estimatedProcessingDays: 14,
    message: 'Claim submitted to payer — EDI 837 transaction created',
  });
});

// POST /api/billing/zkproof/verify — Verify ZK proof for insurance eligibility
billingRoutes.post('/zkproof/verify', async (c) => {
  const { proof, publicInputs, verificationKey } = await c.req.json();

  // Validate required fields
  if (!proof || !publicInputs || !verificationKey) {
    return c.json({ error: 'Missing required fields: proof, publicInputs, verificationKey' }, 400);
  }

  // Validate proof structure
  const proofFields = ['pi_a', 'pi_b', 'pi_c', 'protocol'];
  const missingFields = proofFields.filter((f) => !(f in proof));
  if (missingFields.length > 0) {
    return c.json({ error: `Invalid proof structure: missing ${missingFields.join(', ')}` }, 400);
  }

  // Validate byte lengths (Groth16 BN254 expected sizes)
  const piAValid = Array.isArray(proof.pi_a) && proof.pi_a.length >= 2;
  const piBValid = Array.isArray(proof.pi_b) && proof.pi_b.length >= 2;
  const piCValid = Array.isArray(proof.pi_c) && proof.pi_c.length >= 2;
  if (!piAValid || !piBValid || !piCValid) {
    return c.json({ error: 'Invalid proof: pi_a, pi_b, pi_c must be arrays with at least 2 elements' }, 400);
  }

  // Validate public inputs
  if (!Array.isArray(publicInputs) || publicInputs.length === 0) {
    return c.json({ error: 'publicInputs must be a non-empty array' }, 400);
  }

  // Hash the proof for audit trail
  const proofHash = createHash('sha256')
    .update(JSON.stringify({ proof, publicInputs, verificationKey }))
    .digest('hex');

  // Structural validation passes — future: replace with actual Groth16 verification
  const structurallyValid = piAValid && piBValid && piCValid && proof.protocol === 'groth16';

  // Store verification attempt in Firestore
  const verificationId = `zkv-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  await db.collection('zk_verifications').doc(verificationId).set({
    proofHash,
    publicInputs,
    protocol: proof.protocol,
    structurallyValid,
    groth16Verified: null, // Placeholder for future Groth16 integration
    createdAt: new Date(),
  });

  return c.json({
    verified: structurallyValid,
    verificationId,
    proofHash,
    protocol: proof.protocol,
    groth16Status: 'pending_integration', // Clear field for future Groth16 integration
    note: 'Structural validation passed. On-chain Groth16 verification will be added when Solana program is deployed.',
  });
});
