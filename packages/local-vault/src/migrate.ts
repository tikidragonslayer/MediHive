/**
 * MediHive — Copyright (C) 2024-2026 The MediHive Authors
 * Licensed under the GNU Affero General Public License v3.0 or later.
 *
 * Idempotent migration runner. Applies SQL files in lexical order from
 * src/migrations/ and records each in schema_migrations.
 *
 * Usage:
 *   DATABASE_URL=postgres://... npm run migrate --workspace=@medi-hive/local-vault
 */

import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';

const MIGRATIONS_DIR = join(__dirname, 'migrations');

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is required.');
    process.exit(1);
  }

  const client = new Client({ connectionString: url });
  await client.connect();

  try {
    // Ensure tracking table exists before reading from it.
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version    TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const applied = new Set<string>(
      (await client.query<{ version: string }>('SELECT version FROM schema_migrations')).rows.map(
        (r) => r.version,
      ),
    );

    const files = readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const version = file.replace(/\.sql$/, '');
      if (applied.has(version)) {
        console.log(`= ${version} (already applied)`);
        continue;
      }
      const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
      console.log(`+ ${version}`);
      await client.query('BEGIN');
      try {
        await client.query(sql);
        // 001_init.sql also self-records, so this is a no-op on conflict.
        await client.query(
          'INSERT INTO schema_migrations (version) VALUES ($1) ON CONFLICT DO NOTHING',
          [version],
        );
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }
    console.log('migrations complete');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
