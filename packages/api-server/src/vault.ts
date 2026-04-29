/**
 * MediHive — Copyright (C) 2024-2026 The MediHive Authors
 * Licensed under the GNU Affero General Public License v3.0 or later.
 *
 * Vault driver factory. Reads MEDIHIVE_PROFILE at process start and
 * returns the matching VaultDriver. The rest of the api-server depends
 * only on the VaultDriver interface.
 *
 * Profile selection
 * -----------------
 *   MEDIHIVE_PROFILE=local      → LocalVaultDriver (Postgres)
 *   MEDIHIVE_PROFILE=onchain    → SolanaVaultDriver
 *   MEDIHIVE_PROFILE=federated  → FederatedVaultDriver
 *                                  (Postgres + read-only on-chain via
 *                                   PatientBridgeStore)
 *   (default)                   → local
 *
 * The federated profile lets a hospital running on Postgres also serve
 * read-only patient-sovereign records from Solana when the patient has
 * established a signed bridge between their on-chain wallet and the
 * hospital's local passport. Hospitals never write on-chain.
 */

import { Pool } from 'pg';
import type { VaultDriver } from '@medi-hive/vault-driver';
import {
  Ed25519BridgeVerifier,
  FederatedVaultDriver,
  LocalVaultDriver,
  PatientBridgeStore,
} from '@medi-hive/local-vault';
import { SolanaVaultDriver } from './solana-vault';

export type Profile = 'local' | 'onchain' | 'federated';

export interface VaultContext {
  driver: VaultDriver;
  profile: Profile;
  /** Set on federated profile so the bridge-link endpoint can use it. */
  bridgeStore?: PatientBridgeStore;
}

export function readProfile(): Profile {
  const raw = (process.env.MEDIHIVE_PROFILE ?? 'local').toLowerCase().trim();
  if (raw === 'federated' || raw === 'fed' || raw === 'hybrid') return 'federated';
  if (raw === 'onchain' || raw === 'on-chain' || raw === 'solana') return 'onchain';
  if (raw === 'local' || raw === 'postgres' || raw === 'db') return 'local';
  console.warn(`[vault] MEDIHIVE_PROFILE="${raw}" not recognized; defaulting to "local"`);
  return 'local';
}

export function createVaultContext(profile: Profile = readProfile()): VaultContext {
  switch (profile) {
    case 'local':
      return {
        profile,
        driver: new LocalVaultDriver({
          backendLabel: process.env.DATABASE_LABEL ?? 'postgres',
        }),
      };

    case 'onchain':
      return {
        profile,
        driver: new SolanaVaultDriver({
          cluster: process.env.SOLANA_CLUSTER ?? 'devnet',
          ...(process.env.SOLANA_RPC_URL && { rpcUrl: process.env.SOLANA_RPC_URL }),
        }),
      };

    case 'federated': {
      // Federated mode shares one Pool between LocalVaultDriver and
      // PatientBridgeStore so they hit the same connection limit budget.
      const url = process.env.DATABASE_URL;
      if (!url) {
        throw new Error(
          'MEDIHIVE_PROFILE=federated requires DATABASE_URL (the local-side Postgres).',
        );
      }
      const pool = new Pool({ connectionString: url });
      const local = new LocalVaultDriver({ pool });
      const onchain = new SolanaVaultDriver({
        cluster: process.env.SOLANA_CLUSTER ?? 'devnet',
        ...(process.env.SOLANA_RPC_URL && { rpcUrl: process.env.SOLANA_RPC_URL }),
      });
      const bridgeStore = new PatientBridgeStore(pool, new Ed25519BridgeVerifier());
      const driver = new FederatedVaultDriver({ local, onchain, bridgeStore });
      return { profile, driver, bridgeStore };
    }
  }
}

/** Backwards-compatible shim: many call sites just want the driver. */
export function createVaultDriver(profile: Profile = readProfile()): VaultDriver {
  return createVaultContext(profile).driver;
}
