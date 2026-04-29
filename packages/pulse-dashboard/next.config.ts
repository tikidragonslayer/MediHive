import type { NextConfig } from "next";
import path from "path";

/**
 * Pulse dashboard Next.js config.
 *
 * `output: 'standalone'` produces a self-contained server bundle in
 * .next/standalone/ — that's what the Docker image runs. Without this,
 * the dashboard would need the full repo in the runtime image.
 *
 * `outputFileTracingRoot` points at the monorepo root so Next can
 * include the lockfile and any hoisted node_modules the standalone
 * server needs at runtime.
 */
const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
};

export default nextConfig;
