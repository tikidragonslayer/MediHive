import { MediRole } from './middleware/auth';
import type { VaultDriver } from '@medi-hive/vault-driver';
import type { PatientBridgeStore } from '@medi-hive/local-vault';

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
     * Active VaultDriver. LocalVaultDriver in `local` profile,
     * SolanaVaultDriver in `onchain`, FederatedVaultDriver in
     * `federated`. Set by the global vaultMiddleware so every route
     * handler can read it via `c.var.vault`.
     */
    vault: VaultDriver;
    /**
     * Bridge store. Only present on the federated profile. Routes that
     * link/revoke patient bridges go through this. Routes that don't
     * touch bridges should leave it alone.
     */
    bridgeStore?: PatientBridgeStore;
  };
};
