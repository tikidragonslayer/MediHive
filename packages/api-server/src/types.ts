import { MediRole } from './middleware/auth';
import type { VaultDriver } from '@medi-hive/vault-driver';

/** Hono context variables set by middleware */
export type AppEnv = {
  Variables: {
    /** Set by authMiddleware on /api/* routes */
    auth: {
      pubkey: string;
      role: MediRole;
      permissions: string[];
    };
    /**
     * Vault driver (Postgres-backed in `local` profile, Solana in
     * `onchain` profile). Set by the global vaultMiddleware so every
     * route handler can read it via `c.var.vault` or `c.get('vault')`.
     */
    vault: VaultDriver;
  };
};
