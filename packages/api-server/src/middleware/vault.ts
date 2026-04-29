/**
 * MediHive — Copyright (C) 2024-2026 The MediHive Authors
 * Licensed under the GNU Affero General Public License v3.0 or later.
 *
 * Hono middleware that injects the active VaultDriver (and, on
 * federated profile, the PatientBridgeStore) into the request context
 * so every route handler can call `c.var.vault.<method>(...)` and
 * `c.var.bridgeStore?.<method>(...)` without importing a concrete driver.
 */

import { MiddlewareHandler } from 'hono';
import type { VaultDriver } from '@medi-hive/vault-driver';
import type { PatientBridgeStore } from '@medi-hive/local-vault';
import { AppEnv } from '../types';

export interface VaultMiddlewareOptions {
  driver: VaultDriver;
  bridgeStore?: PatientBridgeStore;
}

export function vaultMiddleware(opts: VaultMiddlewareOptions): MiddlewareHandler<AppEnv>;
export function vaultMiddleware(driver: VaultDriver): MiddlewareHandler<AppEnv>;
export function vaultMiddleware(
  arg: VaultDriver | VaultMiddlewareOptions,
): MiddlewareHandler<AppEnv> {
  // Support both calling conventions so existing call sites (which pass
  // a bare driver) keep working.
  const opts: VaultMiddlewareOptions =
    'driver' in arg ? arg : { driver: arg };

  return async (c, next) => {
    c.set('vault', opts.driver);
    if (opts.bridgeStore) {
      c.set('bridgeStore', opts.bridgeStore);
    }
    await next();
  };
}
