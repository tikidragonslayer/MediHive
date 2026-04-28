/**
 * Firebase Cloud Functions entry point — exports all scheduled/triggered functions.
 *
 * Deploy with:
 *   firebase deploy --only functions
 *
 * This is separate from the Hono API server (index.ts) because Cloud Functions
 * have their own lifecycle managed by the Firebase Functions runtime.
 *
 * Functions exported here:
 * - mediBrainTick: runs every 60s, performs the full AI brain cycle
 * - mediBrainCleanup: runs daily at 3 AM, prunes stale acuity history
 */

export { mediBrainTick, mediBrainCleanup } from './services/scheduler-function';
