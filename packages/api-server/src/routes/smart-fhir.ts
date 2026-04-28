import { Hono } from 'hono';

/**
 * SMART on FHIR Enhanced — OAuth 2.0 launch endpoints.
 *
 * Required by September 2026 for all EHR integrations (Epic, Cerner, MEDITECH).
 * Implements two launch flows:
 *
 * 1. EHR Launch: Patient clicks "Medi-Hive" inside Epic MyChart
 *    → Epic redirects to /smart/launch with context (patient ID, FHIR server)
 *    → We exchange auth code for access token
 *    → We read patient FHIR data and sync to blockchain
 *
 * 2. Standalone Launch: User opens Medi-Hive app directly
 *    → App redirects to EHR login page
 *    → User authenticates with EHR credentials
 *    → We get access token and proceed
 *
 * Spec: https://docs.smarthealthit.org/
 */

export const smartFhirRoutes = new Hono();

// .well-known/smart-configuration — Required SMART discovery endpoint
smartFhirRoutes.get('/.well-known/smart-configuration', (c) => {
  const baseUrl = process.env.SMART_BASE_URL ?? 'http://localhost:4000';
  return c.json({
    authorization_endpoint: `${baseUrl}/smart/authorize`,
    token_endpoint: `${baseUrl}/smart/token`,
    capabilities: [
      'launch-ehr',
      'launch-standalone',
      'client-public',
      'client-confidential-symmetric',
      'sso-openid-connect',
      'context-ehr-patient',
      'context-standalone-patient',
      'permission-patient',
      'permission-user',
      'permission-offline',
    ],
    scopes_supported: [
      'openid',
      'fhirUser',
      'launch',
      'launch/patient',
      'patient/*.read',
      'patient/*.write',
      'user/*.read',
      'offline_access',
    ],
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
  });
});

// GET /smart/launch — EHR Launch (Epic/Cerner sends user here)
smartFhirRoutes.get('/launch', (c) => {
  const iss = c.req.query('iss'); // FHIR server URL
  const launch = c.req.query('launch'); // Opaque launch context token

  if (!iss || !launch) {
    return c.json({ error: 'Missing iss or launch parameter' }, 400);
  }

  // Store launch context, redirect to EHR authorization endpoint
  // In production: discover auth endpoint from iss/.well-known/smart-configuration
  const state = Buffer.from(JSON.stringify({ iss, launch, ts: Date.now() })).toString('base64url');
  const clientId = process.env.SMART_CLIENT_ID ?? 'medi-hive-prototype';
  const redirectUri = `${process.env.SMART_BASE_URL ?? 'http://localhost:4000'}/smart/callback`;
  const scope = 'launch patient/*.read openid fhirUser';

  // Redirect to EHR's authorization endpoint
  // In production: fetch ${iss}/.well-known/smart-configuration to get the real auth URL
  const authUrl = `${iss}/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${state}&launch=${launch}&aud=${encodeURIComponent(iss)}`;

  return c.redirect(authUrl);
});

// GET /smart/callback — OAuth callback after EHR authorization
smartFhirRoutes.get('/callback', async (c) => {
  const code = c.req.query('code');
  const state = c.req.query('state');
  const error = c.req.query('error');

  if (error) {
    return c.json({ error: `EHR authorization failed: ${error}` }, 400);
  }

  if (!code || !state) {
    return c.json({ error: 'Missing code or state parameter' }, 400);
  }

  // Decode state to get original ISS
  let launchContext: { iss: string; launch: string };
  try {
    launchContext = JSON.parse(Buffer.from(state, 'base64url').toString());
  } catch {
    return c.json({ error: 'Invalid state parameter' }, 400);
  }

  // Exchange authorization code for access token
  // In production: fetch token from ${iss}/.well-known/smart-configuration token_endpoint
  const tokenUrl = `${launchContext.iss}/oauth2/token`;
  const clientId = process.env.SMART_CLIENT_ID ?? 'medi-hive-prototype';
  const redirectUri = `${process.env.SMART_BASE_URL ?? 'http://localhost:4000'}/smart/callback`;

  try {
    const tokenResponse = await fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
      }),
    });

    if (!tokenResponse.ok) {
      const err = await tokenResponse.text();
      return c.json({ error: `Token exchange failed: ${err}` }, 400);
    }

    const tokenData = await tokenResponse.json() as {
      access_token: string;
      token_type: string;
      expires_in: number;
      scope: string;
      patient?: string;
      id_token?: string;
    };

    // Now we have FHIR access — sync patient data to blockchain
    // Redirect to dashboard with session info
    const dashboardUrl = process.env.DASHBOARD_URL ?? 'http://localhost:3000';
    const sessionToken = Buffer.from(JSON.stringify({
      fhirServer: launchContext.iss,
      accessToken: tokenData.access_token,
      patientId: tokenData.patient,
      expiresIn: tokenData.expires_in,
    })).toString('base64url');

    return c.redirect(`${dashboardUrl}?smart_session=${sessionToken}`);
  } catch (err) {
    return c.json({ error: `Token exchange error: ${err instanceof Error ? err.message : 'unknown'}` }, 500);
  }
});

// GET /smart/authorize — Standalone launch (Medi-Hive initiates)
smartFhirRoutes.get('/authorize', (c) => {
  const fhirServer = c.req.query('fhir_server');
  if (!fhirServer) {
    return c.json({ error: 'Provide fhir_server query parameter (e.g., https://fhir.epic.com/...)' }, 400);
  }

  const clientId = process.env.SMART_CLIENT_ID ?? 'medi-hive-prototype';
  const redirectUri = `${process.env.SMART_BASE_URL ?? 'http://localhost:4000'}/smart/callback`;
  const scope = 'launch/patient patient/*.read openid fhirUser';
  const state = Buffer.from(JSON.stringify({ iss: fhirServer, launch: 'standalone', ts: Date.now() })).toString('base64url');

  const authUrl = `${fhirServer}/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=${encodeURIComponent(scope)}&state=${state}&aud=${encodeURIComponent(fhirServer)}`;

  return c.redirect(authUrl);
});

// POST /smart/token — Token endpoint (if Medi-Hive acts as auth server for sub-apps)
smartFhirRoutes.post('/token', async (c) => {
  // This would be used if other apps integrate WITH Medi-Hive as a FHIR server
  return c.json({ error: 'Not yet implemented — Medi-Hive as FHIR server coming in Phase 3' }, 501);
});
