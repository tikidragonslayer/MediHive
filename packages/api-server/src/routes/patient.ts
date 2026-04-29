import { Hono } from 'hono';
import { AppEnv } from '../types';
import { collections } from '../db';
import { requirePermission } from '../middleware/auth';
import { RecordType } from '@medi-hive/vault-driver';

export const patientRoutes = new Hono<AppEnv>();

// ─────────────────────────────────────────────────────────────────────
// VaultDriver-backed endpoints (v2)
//
// These endpoints go through the active VaultDriver (LocalVaultDriver
// for MEDIHIVE_PROFILE=local, SolanaVaultDriver for =onchain) instead
// of Firestore. They exist alongside the legacy v1 endpoints below
// while route-by-route migration proceeds.
//
// On-chain caveat: the on-chain SDK addresses passports by Solana
// wallet, not by an internal hospital ID. For local profile, the
// auth.pubkey is also used directly as the passport authority so the
// same auth flow works for both profiles.
// ─────────────────────────────────────────────────────────────────────

// GET /api/patient/v2/passport — VaultDriver-backed passport read
patientRoutes.get('/v2/passport', async (c) => {
  const auth = c.get('auth') as { pubkey: string };
  const vault = c.get('vault');

  // The vault driver's getPassport expects an Identity (passport id).
  // For the on-chain profile that's the wallet pubkey; for local it's
  // a UUID stored against the wallet as `authority`. We try both:
  // direct passport-id lookup first, then a wallet-keyed scan.
  // For now we try the direct lookup (works on-chain). Local-profile
  // patients should use /onboard to bootstrap a passport, then store
  // the returned UUID client-side.
  const passport = await vault.getPassport(auth.pubkey).catch(() => null);
  if (!passport) {
    return c.json(
      {
        error: 'Passport not found',
        hint:
          'On the local profile, look up by your passport UUID returned from /v2/onboard, ' +
          'not by your wallet pubkey.',
      },
      404,
    );
  }
  return c.json({ passport });
});

// GET /api/patient/v2/records/:passportId — VaultDriver-backed record list
patientRoutes.get('/v2/records/:passportId', async (c) => {
  const auth = c.get('auth') as { pubkey: string };
  const vault = c.get('vault');
  const passportId = c.req.param('passportId');

  // Authorization: a patient may only read their own passport's records.
  const passport = await vault.getPassport(passportId);
  if (!passport) return c.json({ error: 'Passport not found' }, 404);
  if (passport.authority !== auth.pubkey) {
    return c.json({ error: 'Forbidden: not your passport' }, 403);
  }

  const url = new URL(c.req.url);
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '50', 10), 500);
  const cursor = url.searchParams.get('cursor') ?? undefined;
  const typesParam = url.searchParams.get('types');
  const types = typesParam
    ? (typesParam.split(',').filter((t) =>
        Object.values(RecordType).includes(t as RecordType),
      ) as RecordType[])
    : undefined;

  const result = await vault.listRecordsForPatient(passportId, { limit, cursor, types });
  return c.json(result);
});

// GET /api/patient/v2/audit/:passportId — VaultDriver-backed audit trail
patientRoutes.get('/v2/audit/:passportId', async (c) => {
  const auth = c.get('auth') as { pubkey: string };
  const vault = c.get('vault');
  const passportId = c.req.param('passportId');

  const passport = await vault.getPassport(passportId);
  if (!passport) return c.json({ error: 'Passport not found' }, 404);
  if (passport.authority !== auth.pubkey) {
    return c.json({ error: 'Forbidden: not your passport' }, 403);
  }

  const url = new URL(c.req.url);
  const since = url.searchParams.get('since')
    ? parseInt(url.searchParams.get('since')!, 10)
    : undefined;
  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '200', 10), 1000);

  const entries = await vault.listAuditForPatient(passportId, { since, limit });
  return c.json({ entries });
});

// ─────────────────────────────────────────────────────────────────────
// Bridge link — federated profile only
//
// The patient-signed flow:
//   1. Patient's mobile wallet signs canonical JSON of:
//        { localPassportId, onchainPassportId, nonce, timestamp }
//   2. Front-desk terminal POSTs the signed payload to this endpoint.
//   3. We verify the signature against the on-chain pubkey and, if
//      valid, insert a non-revoked bridge row.
//
// This endpoint is a 404 on profiles that don't run a bridge store
// (local-only and onchain-only). It explicitly does not bypass the
// bridge store's verification — the verifier is the same Ed25519
// implementation used in the integration tests.
// ─────────────────────────────────────────────────────────────────────
patientRoutes.post('/v2/bridge', async (c) => {
  const auth = c.get('auth') as { pubkey: string };
  const bridgeStore = c.get('bridgeStore');

  if (!bridgeStore) {
    return c.json(
      {
        error: 'Bridge linking is only available on MEDIHIVE_PROFILE=federated',
        hint: 'Set MEDIHIVE_PROFILE=federated and ensure DATABASE_URL points at the local-side Postgres.',
      },
      404,
    );
  }

  type BridgeBody = {
    localPassportId: string;
    onchainPassportId: string;
    signatureB64: string;
    nonce: string;
    timestamp: number;
    onchainRecordTypes?: string[];
  };
  const body = (await c.req.json().catch(() => null)) as BridgeBody | null;
  if (
    !body ||
    typeof body.localPassportId !== 'string' ||
    typeof body.onchainPassportId !== 'string' ||
    typeof body.signatureB64 !== 'string' ||
    typeof body.nonce !== 'string' ||
    typeof body.timestamp !== 'number'
  ) {
    return c.json(
      {
        error:
          'Body must be { localPassportId, onchainPassportId, signatureB64, nonce, timestamp, onchainRecordTypes? }',
      },
      400,
    );
  }

  // Authorization: the requester's auth.pubkey must match the on-chain
  // pubkey they're claiming. This prevents an attacker from binding
  // someone else's wallet to the local passport.
  if (auth.pubkey !== body.onchainPassportId) {
    return c.json(
      {
        error: 'Forbidden: auth.pubkey must match onchainPassportId in the bridge request.',
      },
      403,
    );
  }

  try {
    const bridge = await bridgeStore.createBridge({
      localPassportId: body.localPassportId,
      onchainPassportId: body.onchainPassportId,
      establishedVia: 'patient_signed',
      signatureB64: body.signatureB64,
      signatureNonce: body.nonce,
      signatureTimestamp: body.timestamp,
      onchainRecordTypes: body.onchainRecordTypes ?? [],
    });
    return c.json({ bridge }, 201);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Bridge creation failed';
    // Map known error shapes to specific status codes.
    if (msg.match(/verification failed/i)) return c.json({ error: msg }, 400);
    if (msg.match(/skew/i)) return c.json({ error: msg }, 400);
    if (msg.match(/at least one of/i)) return c.json({ error: msg }, 400);
    return c.json({ error: msg }, 500);
  }
});

// DELETE /api/patient/v2/bridge/:bridgeId — patient-initiated revocation
patientRoutes.delete('/v2/bridge/:bridgeId', async (c) => {
  const bridgeStore = c.get('bridgeStore');
  if (!bridgeStore) return c.json({ error: 'Bridge linking unavailable on this profile' }, 404);

  const id = c.req.param('bridgeId');
  try {
    const bridge = await bridgeStore.revoke(id);
    return c.json({ bridge });
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Revoke failed';
    return c.json({ error: msg }, 404);
  }
});

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
