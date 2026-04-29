# Changelog

All notable changes to MediHive will be documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
follows [Semantic Versioning](https://semver.org/) where reasonable for a
pre-1.0 codebase.

## [0.4.0] — 2026-04-29

The federation release. A hospital running the local profile can now serve **read-only** patient-sovereign records from Solana when the patient has signed a bridge between their on-chain wallet and the hospital's local passport. Hospitals never write on-chain.

### Added

- **`MEDIHIVE_PROFILE=federated`** — third profile, alongside `local` and `onchain`.
- **`@medi-hive/local-vault`** new exports:
  - `PatientBridgeStore` — Postgres-backed bridge linkage store.
  - `Ed25519BridgeVerifier` — verifies wallet signatures over canonicalized bridge payloads using Node's built-in crypto (no extra deps).
  - `FederatedVaultDriver` — wraps a `LocalVaultDriver` (writes go here) and a read-only on-chain `VaultDriver` (records the patient curated). Reads merge sorted by `createdAt`. On-chain RPC failures degrade gracefully — local reads still return.
  - `canonicalizeBridge` and `BridgePayload` — canonical JSON for the signed bridge envelope.
- **Schema migration `002_bridges.sql`** — `patient_bridges` table with:
  - Composite identity (local_passport_id, onchain_passport_id) — at least one must be non-null.
  - Patient-side per-record-type allowlist (`onchain_record_types`).
  - Detached Ed25519 signature + nonce + timestamp for `patient_signed` bridges.
  - Revocation column so a patient can disable a previous link without losing the audit row.
  - Functional unique index on the (local, onchain) pair while `revoked_at IS NULL`.
- **`POST /api/patient/v2/bridge`** — patient-signed bridge link endpoint. Returns 400 on bad signature or stale timestamp, 403 on auth-pubkey mismatch, 404 on non-federated profiles.
- **`DELETE /api/patient/v2/bridge/:id`** — patient-initiated revocation.
- **21 new tests** covering bridge store, Ed25519 verifier, federated driver merge logic, signature timestamp skew, type allowlist filtering, on-chain RPC failure resilience, write-only-to-local enforcement, and the full HTTP bridge-link flow.

### Changed

- **`vaultMiddleware`** signature now accepts either a bare `VaultDriver` (legacy) or `{ driver, bridgeStore }` (federated). Backward-compatible.
- **`AppEnv.Variables`** gains `bridgeStore?: PatientBridgeStore` for routes on federated profile.
- **api-server `vault.ts`** factory now returns a `VaultContext` exposing both the driver and the optional bridge store. The legacy `createVaultDriver` function still works.
- **`vitest.config.ts`** added to both `local-vault` and `api-server` to force serial execution of integration tests (they share a Postgres DB and TRUNCATE between tests).
- **`db.ts`** wraps `Firestore.settings()` in try/catch so module re-import across test files doesn't fatally throw.

### Test count

| Suite | Tests |
|---|---|
| local-vault audit-chain (unit) | 7 |
| local-vault driver (Postgres integration) | 17 |
| local-vault federation (bridge + Ed25519 + federated driver) | 15 |
| shield-encryption (Shamir + crypto) | 48 |
| api-server patient routes via vault (HTTP integration) | 7 |
| api-server bridge endpoint (HTTP integration) | 6 |
| **Total** | **100** |

## [0.3.0] — 2026-04-29

The credibility release. Closes the largest gap from v0.2.0: the api-server now actually uses the VaultDriver instead of going through Firestore at every endpoint.

### Added

- **First VaultDriver-backed routes**: `/api/patient/v2/passport`, `/api/patient/v2/records/:passportId`, `/api/patient/v2/audit/:passportId`. They go through the active driver (Postgres in local profile, Solana in onchain) instead of Firestore.
- **API-level integration tests** (`packages/api-server/src/__tests__/patient-vault.integration.test.ts`): 7 tests exercise HTTP → Hono → vaultMiddleware → LocalVaultDriver → real Postgres. Cover happy path, type-filter query params, ownership-based authorization (403), and 404 with helpful hints.
- **Postgres integration test job** in CI (`.github/workflows/ci.yml`): spins up `postgres:16-alpine` as a service container, applies the migration, runs the local-vault and api-server suites with `DATABASE_URL` set.
- **`prepare: tsc` scripts** on every consumed workspace (`vault-driver`, `vault-sdk`, `local-vault`, `brain-engine`) so `npm install` from a fresh clone produces a buildable tree without manual build ordering.

### Changed

- **Silent-success stubs replaced with explicit throws** on the on-chain driver:
  - `SolanaVaultDriver.verifyAuditChain` previously returned `{valid: true, entries: [], rootHash: ''}` for any input — a security false-positive. Now throws with a directional message.
  - `SolanaVaultDriver.getAuditEntry` previously returned `null` without checking — a security false-negative. Now throws.
- **`packages/local-vault/package.json`** — fixed `"@medi-hive/vault-driver"` from `"0.1.0"` (which broke clean installs) to `"file:../vault-driver"`.
- **README** — replaced "two first-class profiles" framing with honest status: local is read+write fully tested, onchain is read-only with the transaction layer in progress. Quick start now reflects the actual `brew install postgresql@16` flow.

### Test count

| Suite | Tests |
|---|---|
| local-vault (audit-chain unit) | 7 |
| local-vault (Postgres integration) | 17 |
| shield-encryption (Shamir + crypto) | 48 |
| api-server (HTTP → Hono → driver → Postgres) | 7 |
| **Total** | **79** |

## [0.2.0] — 2026-04-28

The dual-profile release. MediHive now runs with or without the on-chain
layer, controlled by a single environment variable.

### Added

- **`@medi-hive/vault-driver`** — profile-agnostic interface package
  defining `VaultDriver` in terms of opaque `Identity` strings. Covers
  patient passports, medical records, access grants, consent records,
  and audit. The rest of MediHive depends on this interface, not on
  any concrete driver.
- **`@medi-hive/local-vault`** — Postgres-backed `LocalVaultDriver`:
  - SQL schema (`001_init.sql`) with append-only `audit_log` enforced
    by triggers, record-deletion blocked past draft state,
    emergency-grant 4-hour cap, Shamir threshold check on guardians.
  - Hash-chained audit primitive: `SHA-256(prevHash || canonical(payload))`.
    Tampering anywhere produces a different chain root, detectable
    against externally published WORM checkpoints — even from a database
    administrator.
  - Migration runner (`npm run migrate --workspace=@medi-hive/local-vault`).
  - `vitest` coverage for canonicalization, chain replay, tamper
    detection, and reorder detection (no Postgres required to run).
- **`SolanaVaultDriver` stub** in api-server. `info()` returns real
  metadata; method calls throw a directional error pointing operators to
  the local profile or to contribute the full driver. Keeps the
  api-server's runtime dependency graph clean of `@solana/web3.js` until
  the on-chain driver lands.
- **Hono DI middleware** that injects the singleton vault driver into
  `c.var.vault` so every route can read it without importing a concrete
  driver.
- **`MEDIHIVE_PROFILE` env var** with values `local` (default) or
  `onchain`. `/health` and the new `/health/vault` endpoint report the
  active profile and driver metadata.
- **`infra/docker-compose.local.yml`** — one-command on-prem deployment
  (Postgres + api + dashboard, all loopback-bound, no Solana required).
- **`docs/profiles.md`** — side-by-side `local` vs `onchain` comparison,
  HIPAA technical safeguards (45 CFR §164.312) mapping, migration notes.
- **README "Choose your profile" table** at the top so the dual-mode
  story is visible to first-time visitors.

### Changed

- **`/health`** is no longer dishonest. It used to hardcode
  `solana: devnet` regardless of configuration. It now reports the real
  active profile and driver backend.
- **api-server boot logs** print the active profile and vault backend.
- **README architecture table** lists `vault-driver` and `local-vault`
  as part of the vault layer alongside the on-chain packages.

### Deferred to a future release

- **Full `SolanaVaultDriver` implementation** wrapping the Anchor
  programs in `vault-programs` / `vault-sdk` through the new interface.
- **Migration of `services/blockchain-sync.ts`** to import types from
  `@medi-hive/vault-driver` (requires the full Solana driver).
- **Per-route migration** of audit, record-create, and grant flows to
  call `c.var.vault.*` instead of going through the Firestore `db`
  layer. This will happen workflow-by-workflow.
- **Turnkey `local` → `onchain` migration tool**. Records stay
  FHIR-shaped throughout, so the migration is anchoring rather than
  remodeling, but a one-command tool would help adoption.

## [0.1.0] — 2026-04-28

Initial open-source release.

### Added

- 13-package monorepo: `vault-programs` (Anchor), `vault-sdk`,
  `shield-encryption` (Shamir 3-of-5, proxy re-encryption, BIP-44/SLIP-0010),
  `bridge-fhir-adapter`, `bridge-core`, `health-bridge`, `scribe-asr`,
  `scribe-nlp`, `brain-engine` (NEWS2 acuity, nurse routing, alert
  triage), `pulse-dashboard` (Next.js), `api-server` (Hono, 75+
  endpoints), `mobile-sdk`, `shared`.
- 5 Anchor programs: `patient_passport`, `record_manager`,
  `access_grants`, `consent_registry`, `audit_logger`.
- Whitepaper and workflow simulations in `docs/`.
- AGPL-3.0 license + NOTICE crediting the original developer.
- `CONTRIBUTING.md` (DCO sign-off, scope of contributions, dev setup).
- `SECURITY.md` (threat model summary, private disclosure, HIPAA
  compliance disclaimer).
- GitHub Actions CI (typecheck + test + AGPL license sanity).
