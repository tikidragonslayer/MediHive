/**
 * MediHive — Copyright (C) 2024-2026 The MediHive Authors
 * Licensed under the GNU Affero General Public License v3.0 or later.
 *
 * Hono middleware that injects the active VaultDriver into the request
 * context so every route handler can call `c.var.vault.<method>(...)`
 * without importing a concrete driver. Built once at startup and
 * shared across requests.
 */

import { MiddlewareHandler } from 'hono';
import type { VaultDriver } from '@medi-hive/vault-driver';
import { AppEnv } from '../types';

export function vaultMiddleware(driver: VaultDriver): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    c.set('vault', driver);
    await next();
  };
}
