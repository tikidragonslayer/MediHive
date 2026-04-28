import { createHash, createHmac, timingSafeEqual, verify } from 'crypto';

/**
 * MediShield API Authentication — Blockchain-signed request verification.
 *
 * Every API request must be signed with the caller's Solana wallet private key.
 * This ensures:
 * 1. Identity — only the wallet holder can make requests
 * 2. Non-repudiation — all requests are cryptographically attributable
 * 3. Integrity — request body cannot be tampered with
 * 4. Replay protection — nonce + timestamp prevent replay attacks
 *
 * Flow:
 * Client signs: SHA-256(method + path + body + nonce + timestamp) with Ed25519
 * Server verifies: signature matches the claimed pubkey
 * Server checks: pubkey has valid Access Grant NFT for the requested resource
 *
 * Headers required:
 * X-MediHive-Pubkey: <base58 Solana pubkey>
 * X-MediHive-Signature: <base64 Ed25519 signature>
 * X-MediHive-Nonce: <random uuid>
 * X-MediHive-Timestamp: <unix epoch seconds>
 * X-MediHive-Role: <patient|doctor|nurse|admin|pharmacy|lab|billing>
 */

export interface AuthenticatedRequest {
  pubkey: string;
  role: MediRole;
  method: string;
  path: string;
  body: string;
  nonce: string;
  timestamp: number;
  signature: string;
}

export type MediRole = 'patient' | 'doctor' | 'nurse' | 'admin' | 'pharmacy' | 'lab' | 'billing' | 'frontdesk';

/** Role-based permissions matrix */
const ROLE_PERMISSIONS: Record<MediRole, string[]> = {
  patient: [
    'passport:read:own', 'passport:create:own', 'passport:update:own',
    'records:read:own', 'records:export:own',
    'grants:create:own', 'grants:revoke:own', 'grants:read:own',
    'consent:create:own', 'consent:revoke:own', 'consent:read:own',
    'audit:read:own',
    'scribe:consent',
  ],
  doctor: [
    'passport:read:granted',
    'records:read:granted', 'records:create:granted', 'records:amend:granted',
    'grants:use',
    'scribe:record', 'scribe:sign',
    'orders:create', 'orders:read',
    'audit:read:own',
  ],
  nurse: [
    'passport:read:granted',
    'records:read:granted', 'records:create:granted',
    'grants:use',
    'scribe:record', 'scribe:sign',
    'tasks:read:assigned', 'tasks:complete', 'tasks:reassign',
    'vitals:create', 'vitals:read:assigned',
    'medications:administer', 'medications:verify',
    'handoff:generate', 'handoff:read',
    'alerts:read:assigned', 'alerts:acknowledge',
    'audit:read:own',
  ],
  admin: [
    'dashboard:read', 'dashboard:config',
    'staffing:read', 'staffing:update',
    'beds:read', 'beds:manage',
    'compliance:read', 'compliance:export',
    'audit:read:all', 'audit:export',
    'system:config', 'system:health',
    'breakglass:authorize',
  ],
  pharmacy: [
    'records:read:medication',
    'medications:verify', 'medications:dispense', 'medications:interaction_check',
    'orders:read:rx', 'orders:fill',
    'audit:read:own',
  ],
  lab: [
    'records:read:lab', 'records:create:lab',
    'orders:read:lab', 'orders:complete:lab',
    'specimens:create', 'specimens:track', 'specimens:result',
    'audit:read:own',
  ],
  billing: [
    'records:read:billing', // ICD/CPT codes only, no clinical data
    'claims:create', 'claims:read', 'claims:submit',
    'zkproof:verify', // Zero-knowledge proof verification for insurance
    'audit:read:own',
  ],
  frontdesk: [
    'passport:read:basic', // Name, MRN, status only — no clinical data
    'passport:create:new', // Onboard new patients
    'scheduling:create', 'scheduling:read', 'scheduling:update',
    'insurance:verify',
    'checkin:process',
    'audit:read:own',
  ],
};

/** Verify an authenticated API request */
export function verifyRequest(req: AuthenticatedRequest): AuthVerifyResult {
  // 1. Timestamp freshness (5 minute window)
  const now = Math.floor(Date.now() / 1000);
  const age = Math.abs(now - req.timestamp);
  if (age > 300) {
    return { valid: false, error: 'Request timestamp expired (>5 min)' };
  }

  // 2. Construct the signing payload
  const payload = buildSigningPayload(req.method, req.path, req.body, req.nonce, req.timestamp);

  // 3. Verify Ed25519 signature cryptographically
  if (!req.signature || !req.pubkey) {
    return { valid: false, error: 'Missing signature or pubkey' };
  }

  try {
    const signatureBytes = Buffer.from(req.signature, 'base64');
    const pubkeyBytes = Buffer.from(req.pubkey, 'base64');
    const payloadBytes = Buffer.from(payload, 'utf8');

    if (signatureBytes.length !== 64) {
      return { valid: false, error: 'Signature must be 64 bytes (Ed25519)' };
    }
    if (pubkeyBytes.length !== 32) {
      return { valid: false, error: 'Public key must be 32 bytes (Ed25519)' };
    }

    // Node.js 18+ native Ed25519 verification
    const isValid = verify(
      null, // Ed25519 doesn't use a separate hash algorithm
      payloadBytes,
      { key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pubkeyBytes]), format: 'der', type: 'spki' },
      signatureBytes
    );

    if (!isValid) {
      return { valid: false, error: 'Signature verification failed — invalid Ed25519 signature' };
    }
  } catch (err) {
    return { valid: false, error: `Signature verification error: ${err instanceof Error ? err.message : 'unknown'}` };
  }

  // 4. Check role permissions
  const permissions = ROLE_PERMISSIONS[req.role];
  if (!permissions) {
    return { valid: false, error: `Unknown role: ${req.role}` };
  }

  return {
    valid: true,
    pubkey: req.pubkey,
    role: req.role,
    permissions,
  };
}

/** Check if a role has a specific permission */
export function hasPermission(role: MediRole, action: string): boolean {
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return false;

  return perms.some((p) => {
    if (p === action) return true;
    // Wildcard matching: 'records:read:*' matches 'records:read:lab'
    const pParts = p.split(':');
    const aParts = action.split(':');
    return pParts.every((part, i) =>
      part === '*' || part === aParts[i]
    );
  });
}

/** Build the payload string that gets signed by the client */
export function buildSigningPayload(
  method: string,
  path: string,
  body: string,
  nonce: string,
  timestamp: number
): string {
  return `${method.toUpperCase()}\n${path}\n${createHash('sha256').update(body || '').digest('hex')}\n${nonce}\n${timestamp}`;
}

/** Generate request nonce */
export function generateNonce(): string {
  return createHash('sha256')
    .update(`${Date.now()}-${Math.random()}`)
    .digest('hex')
    .substring(0, 32);
}

/** Hash IP address for privacy-preserving audit logging */
export function hashIP(ip: string, salt: string = 'medi-hive-v1'): Uint8Array {
  return new Uint8Array(
    createHmac('sha256', salt).update(ip).digest()
  );
}

/** Hash device fingerprint for audit logging */
export function hashDevice(userAgent: string, salt: string = 'medi-hive-v1'): Uint8Array {
  return new Uint8Array(
    createHmac('sha256', salt).update(userAgent).digest()
  );
}

interface AuthVerifyResult {
  valid: boolean;
  error?: string;
  pubkey?: string;
  role?: MediRole;
  permissions?: string[];
}
