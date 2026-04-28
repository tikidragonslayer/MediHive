/**
 * MediHive — Copyright (C) 2024-2026 The MediHive Authors
 * Licensed under the GNU Affero General Public License v3.0 or later.
 *
 * Vault driver factory. Reads MEDIHIVE_PROFILE at process start and
 * returns the matching VaultDriver. The rest of the api-server depends
 * only on the VaultDriver interface — it does not import @solana/web3.js
 * or pg directly.
 *
 * Profile selection
 * -----------------
 *   MEDIHIVE_PROFILE=local    → @medi-hive/local-vault (Postgres)
 *   MEDIHIVE_PROFILE=onchain  → SolanaVaultDriver (forthcoming)
 *   (default)                 → local
 */

import type { VaultDriver } from '@medi-hive/vault-driver';
import { LocalVaultDriver } from '@medi-hive/local-vault';
import { SolanaVaultDriver } from './solana-vault';

export type Profile = 'local' | 'onchain';

export function readProfile(): Profile {
  const raw = (process.env.MEDIHIVE_PROFILE ?? 'local').toLowerCase().trim();
  if (raw === 'onchain' || raw === 'on-chain' || raw === 'solana') return 'onchain';
  if (raw === 'local' || raw === 'postgres' || raw === 'db') return 'local';
  console.warn(
    `[vault] MEDIHIVE_PROFILE="${raw}" not recognized; defaulting to "local"`,
  );
  return 'local';
}

export function createVaultDriver(profile: Profile = readProfile()): VaultDriver {
  switch (profile) {
    case 'local':
      return new LocalVaultDriver({
        backendLabel: process.env.DATABASE_LABEL ?? 'postgres',
      });
    case 'onchain':
      return new SolanaVaultDriver({
        cluster: process.env.SOLANA_CLUSTER ?? 'devnet',
      });
  }
}
