import { defineConfig } from 'vitest/config';

/**
 * The integration tests share a Postgres database and use TRUNCATE
 * between tests. If multiple test files run in parallel, they stomp
 * each other's setup. Force serial execution.
 *
 * `pool: 'forks'` + `singleFork: true` runs all test files in one
 * worker, sequentially. Slower but correct.
 */
export default defineConfig({
  test: {
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
  },
});
