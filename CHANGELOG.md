# Changelog

All notable changes to MediHive will be documented here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
follows [Semantic Versioning](https://semver.org/) where reasonable for a
pre-1.0 codebase.

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
