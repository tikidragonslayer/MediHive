import { defineConfig } from 'vitest/config';

/**
 * Integration tests share a Postgres database and TRUNCATE between
 * tests. Force serial execution to prevent parallel test files from
 * stomping each other's setup.
 */
export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
