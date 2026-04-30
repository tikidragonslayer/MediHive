# Changelog

All notable changes to MediHive will be documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
follows [Semantic Versioning](https://semver.org/) where reasonable for a
pre-1.0 codebase.

## [0.5.0] — 2026-04-29

The "every role uses the driver" release. Plus the first transaction-builder layer in the vault SDK, plus a recordable demo script, plus the dashboard actually calls the v2 API.

### Highlights

- **117 tests passing** (was 107)
- **All 8 role groups now expose `/v2/*` endpoints** that go through `c.var.vault` instead of Firestore: patient, doctor, nurse, admin, pharmacy, lab, billing, frontdesk
- **`scripts/demo.sh`** — recordable 90-second demo of local + federated profiles. `chmod +x scripts/demo.sh && ./scripts/demo.sh` while QuickTime records the terminal
- **Pulse dashboard `/patient` route** calls `/api/patient/v2/passport`, `/v2/records/:id`, `/v2/audit/:id` with dev-mode auth headers — first real visual proof the API works
- **vault-sdk transaction builders**: `buildCreatePassportIx` and `buildSetPassportStatusIx` for the patient-passport program. 10 new tests pin the Anchor discriminator (`sha256("global:<method>")[0..8]`) and Borsh arg layout

### New `/v2/*` endpoints

| Route file | Endpoint | Scope |
|---|---|---|
| nurse | `GET /v2/patients/:id/records` | active grant; types ⊆ {vital, prescription, note} ∩ grant.scope |
| admin | `GET /v2/audit/:id` | requires `audit:all` permission; appends Export audit |
| admin | `GET /v2/audit-verify` | hash-chain replay; throws 501 on profiles without local chain |
| pharmacy | `GET /v2/patients/:id/prescriptions` | active grant covering Prescription |
| lab | `GET /v2/patients/:id/results` | active grant covering Lab |
| billing | `GET /v2/patients/:id/codes` | salted ICD-codes hash only — no PHI |
| frontdesk | `GET /v2/passport/:id` | passport metadata only — no records, no audit |

### Out of scope (called out)

- I cannot record video. `scripts/demo.sh` is the closest equivalent: a paced, narrated terminal recording the user runs while QuickTime captures.
- I have not run a Solana validator. The vault-sdk transaction builder tests are **serialization correctness** tests (discriminator + Borsh layout). End-to-end devnet tests require `solana-test-validator` running locally and Anchor programs deployed to devnet — separate work.
- The 6 newly-migrated routes ship without HTTP-level integration tests. Only the patient and doctor routes have `*-vault.integration.test.ts` files. Adding parity tests for the other 6 is the next chunk.

### Test breakdown (117)

| Suite | Tests |
|---|---|
| local-vault audit-chain (unit) | 7 |
| local-vault driver (Postgres integration) | 17 |
| local-vault federation (bridge + driver merge) | 15 |
| shield-encryption (Shamir + crypto) | 48 |
| api-server patient routes (HTTP) | 7 |
| api-server bridge endpoint (HTTP) | 6 |
| api-server doctor routes (HTTP) | 7 |
| **vault-sdk passport tx builder (serialization)** | **10** ← new |
| **Total** | **117** |

## [0.4.2] — 2026-04-29

### Added

- **Pulse dashboard now builds + dockerizes**:
  - `packages/pulse-dashboard/next.config.ts` sets `output: 'standalone'` and `outputFileTracingRoot` so Next emits a self-contained server bundle.
  - `infra/Dockerfile.dashboard` two-stage build, Node 20-alpine, runs `node packages/pulse-dashboard/server.js` from the standalone output. ~150 MB image.
  - `infra/docker-compose.local.yml` dashboard service now wired up. `docker compose -f infra/docker-compose.local.yml up` brings up Postgres + api + dashboard end to end.
- Dashboard verified to start cleanly on port 3000 in standalone mode (returns 200 on `/`).

### Changed

- `.gitignore` now excludes `.next/` so build artifacts don't leak into commits.

## [0.4.1] — 2026-04-29

Security + second route migration. Closes the headline dependabot alerts and migrates the doctor route group onto the VaultDriver so two roles now use the v2 path (patient + doctor).

### Security

| Direct dep | Was | Now | Closed alerts |
|---|---|---|---|
| `next` (pulse-dashboard) | 16.2.1 | ^16.2.3 (resolves 16.2.4) | #9, #14 (HIGH) |
| `hono` (api-server) | ^4.4.0 | ^4.12.14 (resolves 4.12.15) | #4–#8, #10 (MEDIUM) |
| `@hono/node-server` | ^1.11.0 | ^1.19.13 (resolves 1.19.14) | #3 (MEDIUM) |
| `vitest` (local-vault, api-server) | ^1.4.0/1.6.1 | ^3.2.4 | indirect: #18, #19 |

Root `package.json` overrides added for `uuid: ^11.0.0`, `@tootallnate/once: ^3.0.0`, `fast-xml-parser: ^5.7.0` to override transitive vulnerable versions.

Remaining open transitive alerts (`uuid@8.3.2` in jayson, `uuid@9.0.1` in google-gax) are not exploitable in our usage — the GHSA covers `v3/v5/v6` UUID generation paths only, and the upstream usage is `v4`. Documented in this CHANGELOG so reviewers know.

### Doctor route migration (second route group on the v2 path)

New endpoints under `/api/doctor/v2/*`:

| Endpoint | What it does |
|---|---|
| `GET /v2/patients/:passportId/records` | Lists records for a patient. Enforces an active access grant via `vault.findActiveGrant(passportId, auth.pubkey)`. Filters returned record types to the intersection of the request and the grant's scope. Increments grant access_count and appends a 'view' audit entry. |
| `GET /v2/patients/:passportId/grant` | Returns the active grant for this doctor on this patient (or 404). |

Authorization decisions now live in the driver: scope, time window, status, max-accesses. The route handler just forwards the doctor's pubkey + the patient passport.

### Tests

| Suite | Was | Now |
|---|---|---|
| local-vault audit-chain | 7 | 7 |
| local-vault driver | 17 | 17 |
| local-vault federation | 15 | 15 |
| shield-encryption | 48 | 48 |
| api-server patient routes (HTTP) | 7 | 7 |
| api-server bridge endpoint (HTTP) | 6 | 6 |
| **api-server doctor routes (HTTP)** | — | **7** ← new |
| **Total** | 100 | **107** |

New doctor-route coverage:
- 403 with hint when doctor has no active grant
- 404 when patient passport doesn't exist
- 200 with scope-filtered records when grant is active
- View audit entry appended after successful read
- ?types= query param narrows to grant-scope intersection
- Out-of-scope type returns empty list with a hint (not 403 — the grant exists, the type is just outside it)
- /grant endpoint returns active grant or 404

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
