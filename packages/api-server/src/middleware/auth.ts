import { Context, Next } from 'hono';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { collections } from '../db';

/**
 * Auth middleware — verifies wallet-signed requests.
 *
 * Every API request must include:
 * - X-MediHive-Pubkey: base58 Solana public key
 * - X-MediHive-Signature: base64 Ed25519 signature
 * - X-MediHive-Nonce: unique request nonce
 * - X-MediHive-Timestamp: unix epoch seconds
 * - X-MediHive-Role: user role
 *
 * For development (NODE_ENV !== 'production'): accepts requests with
 * X-MediHive-Dev: true which skips signature verification but still
 * enforces role permissions.
 */

export type MediRole = 'patient' | 'doctor' | 'nurse' | 'admin' | 'pharmacy' | 'lab' | 'billing' | 'frontdesk';

const ROLE_PERMISSIONS: Record<MediRole, string[]> = {
  patient: ['passport', 'records:own', 'grants:own', 'consent:own', 'audit:own'],
  doctor: ['records:granted', 'scribe', 'orders', 'audit:own'],
  nurse: ['records:granted', 'scribe', 'tasks', 'vitals', 'medications', 'handoff', 'alerts', 'audit:own'],
  admin: ['dashboard', 'staffing', 'beds', 'compliance', 'audit:all', 'system', 'breakglass'],
  pharmacy: ['records:medication', 'medications', 'orders:rx', 'audit:own'],
  lab: ['records:lab', 'orders:lab', 'specimens', 'audit:own'],
  billing: ['records:billing', 'claims', 'zkproof', 'audit:own'],
  frontdesk: ['passport:basic', 'scheduling', 'insurance', 'checkin', 'audit:own'],
};

// --- Nonce replay protection (Firestore-backed with TTL) ---

// --- Rate limiting: 100 requests per pubkey per minute ---
interface RateBucket {
  count: number;
  windowStart: number;
}
const rateLimitMap = new Map<string, RateBucket>();
const RATE_LIMIT_MAX = 100;
const RATE_LIMIT_WINDOW_MS = 60_000;

// Cleanup stale rate-limit entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateLimitMap) {
    if (now - bucket.windowStart > RATE_LIMIT_WINDOW_MS * 2) {
      rateLimitMap.delete(key);
    }
  }
}, 5 * 60_000);

function isRateLimited(pubkey: string): boolean {
  const now = Date.now();
  const bucket = rateLimitMap.get(pubkey);

  if (!bucket || now - bucket.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(pubkey, { count: 1, windowStart: now });
    return false;
  }

  bucket.count++;
  return bucket.count > RATE_LIMIT_MAX;
}

export async function authMiddleware(c: Context, next: Next) {
  // Dev mode: skip signature verification (disabled in production)
  const devMode =
    c.req.header('X-MediHive-Dev') === 'true' &&
    process.env.NODE_ENV !== 'production';

  const role = c.req.header('X-MediHive-Role') as MediRole | undefined;
  const pubkey = c.req.header('X-MediHive-Pubkey') ?? (devMode ? 'dev-pubkey' : undefined);

  if (!role || !ROLE_PERMISSIONS[role]) {
    return c.json({ error: 'Missing or invalid X-MediHive-Role header' }, 401);
  }

  if (!devMode) {
    const signature = c.req.header('X-MediHive-Signature');
    const nonce = c.req.header('X-MediHive-Nonce');
    const timestamp = c.req.header('X-MediHive-Timestamp');

    if (!signature || !nonce || !timestamp || !pubkey) {
      return c.json({ error: 'Missing authentication headers' }, 401);
    }

    // Timestamp freshness (5 min window)
    const age = Math.abs(Date.now() / 1000 - parseInt(timestamp));
    if (age > 300) {
      return c.json({ error: 'Request timestamp expired' }, 401);
    }

    // Nonce replay protection (Firestore-backed)
    const nonceDoc = await collections.used_nonces().doc(nonce).get();
    if (nonceDoc.exists) {
      return c.json({ error: 'Nonce already used' }, 401);
    }
    await collections.used_nonces().doc(nonce).set({
      usedAt: new Date(),
      expireAt: new Date(Date.now() + 5 * 60 * 1000), // TTL: 5 minutes
      pubkey,
    });

    // Rate limiting
    if (isRateLimited(pubkey)) {
      return c.json({ error: 'Rate limit exceeded (100 req/min)' }, 429);
    }

    // Ed25519 signature verification
    try {
      const pubkeyBytes = bs58.decode(pubkey);
      if (pubkeyBytes.length !== 32) {
        return c.json({ error: 'Invalid public key length' }, 401);
      }

      const method = c.req.method;
      const path = new URL(c.req.url).pathname;
      const payload = `${method}:${path}:${nonce}:${timestamp}`;
      const payloadBytes = new TextEncoder().encode(payload);

      const signatureBytes = Buffer.from(signature, 'base64');

      const isValid = nacl.sign.detached.verify(payloadBytes, signatureBytes, pubkeyBytes);
      if (!isValid) {
        return c.json({ error: 'Invalid signature' }, 401);
      }
    } catch {
      return c.json({ error: 'Signature verification failed' }, 401);
    }
  } else {
    // Dev mode still checks rate limits
    if (pubkey && isRateLimited(pubkey)) {
      return c.json({ error: 'Rate limit exceeded (100 req/min)' }, 429);
    }
  }

  // Attach auth context to request
  c.set('auth', { pubkey, role, permissions: ROLE_PERMISSIONS[role] });

  await next();
}

/** Check if the authenticated user has a specific permission */
export function requirePermission(permission: string) {
  return async (c: Context, next: Next) => {
    const auth = c.get('auth') as { pubkey: string; role: MediRole; permissions: string[] } | undefined;
    if (!auth) return c.json({ error: 'Not authenticated' }, 401);

    const hasAccess = auth.permissions.some((p) => permission.startsWith(p) || p === permission);
    if (!hasAccess) {
      return c.json({ error: `Forbidden: ${auth.role} lacks permission ${permission}` }, 403);
    }

    await next();
  };
}
