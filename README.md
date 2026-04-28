# MediHive

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)
[![Version](https://img.shields.io/badge/version-0.2.0-informational)](CHANGELOG.md)
[![Profile: local](https://img.shields.io/badge/profile-local-success)](docs/profiles.md)
[![Profile: onchain](https://img.shields.io/badge/profile-onchain-blueviolet)](docs/profiles.md)
[![CI](https://github.com/tikidragonslayer/MediHive/actions/workflows/ci.yml/badge.svg)](https://github.com/tikidragonslayer/MediHive/actions/workflows/ci.yml)

**Self-hostable hospital records where the patient holds the keys.**

FHIR R4 + AI medical scribe + Solana-anchored access control. AGPL-3.0.

> **License note:** MediHive is licensed under the GNU Affero General Public License v3.0.
> Anyone modifying MediHive **and running it as a network service** (a SaaS, a hosted hospital
> deployment, an internal vendor product) is required by the AGPL to publish their modified
> source code under the same license. This protects the project from being enclosed by closed
> commercial forks and ensures the patient-sovereignty thesis remains intact across deployments.
> Hospitals running unmodified releases internally are not affected.

---

## Why

Healthcare IT has four chronic failures:

- **Data silos.** Records are trapped inside Epic, Cerner, and MEDITECH. Patients re-enter their history at every new provider.
- **Documentation burden.** Nurses spend ~27% of their shift on EHR data entry, only ~25% on direct patient care.
- **Alarm fatigue.** Hospitals generate 700+ alarms per bed per day, 80–99% of them clinically insignificant.
- **Patient powerlessness.** HIPAA grants patients the right to their records, but no practical mechanism exists for them to control, audit, or carry that data.

MediHive addresses all four with a six-layer architecture that **bolts onto existing EHR systems via FHIR R4** rather than replacing them, so a hospital can adopt incrementally.

## Choose your profile

MediHive runs in one of two profiles. Same application code, same FHIR
adapter, same AI scribe — only the underlying vault differs.

| | `local` | `onchain` |
|---|---|---|
| Backend | PostgreSQL | Solana + IPFS/Arweave |
| Wallet required | No | Yes |
| Cross-hospital portability | Manual FHIR export | Native |
| Patient-side revocation | Via portal | Via wallet |
| Tamper-evident audit | Hash-chained + WORM checkpoint | On-chain |
| Best for | Most hospitals starting today | Sovereign-records pilots |
| Quick start | `docker compose -f infra/docker-compose.local.yml up` | See `docs/profiles.md` |

Set `MEDIHIVE_PROFILE=local` or `MEDIHIVE_PROFILE=onchain` at process start.
Both profiles are first-class. See [`docs/profiles.md`](docs/profiles.md)
for a full comparison and the HIPAA technical safeguards story.

## Architecture

| Layer | Package | What it does |
|-------|---------|--------------|
| **VaultDriver** | `vault-driver`, `local-vault`, `vault-programs`, `vault-sdk` | Profile-agnostic interface (`vault-driver`) with two implementations: `local-vault` (Postgres + hash-chained audit) and `vault-sdk`/`vault-programs` (Solana). The rest of MediHive depends only on the interface. |
| **MediBridge** | `bridge-core`, `bridge-fhir-adapter` | FHIR R4 middleware that maps to/from Epic, Cerner, MEDITECH. |
| **MediBrain** | `brain-engine` | NEWS2 acuity scoring, zone-aware nurse routing, contextual alert triage to reduce alarm fatigue. |
| **MediScribe** | `scribe-asr`, `scribe-nlp` | Whisper-based ambient transcription + structured SOAP/FHIR note generation. Audio stays on-prem. |
| **MediShield** | `shield-encryption` | BIP-44 HD keys, Shamir 3-of-5 guardian recovery, proxy re-encryption. |
| **MediPulse** | `pulse-dashboard` | Real-time hospital command center with role-based portals (32 roles, shift-aware). |
| **API + SDKs** | `api-server`, `mobile-sdk`, `health-bridge` | Hono API surface (75+ endpoints), patient mobile SDK, wearables/CGM bridge. |

## Design principles

- **Patient sovereignty.** The patient's wallet *is* their medical record. No institution can lock them out.
- **Bolt-on integration.** EHR stays as-is. MediHive enhances and gradually replaces.
- **Audio stays local.** Voice never leaves hospital premises; only encrypted transcripts go to cloud.
- **On-chain minimalism.** Blockchain stores hashes, access grants, and audit logs. PHI lives encrypted off-chain.
- **No token.** MediHive has no token, no airdrop, no governance coin. Solana is used purely as a tamper-evident anchor and access-control substrate.

## Status

This repository is an **open-source reference implementation**, not a production EHR. It is suitable for:

- Research and academic prototyping
- Pilot deployments under appropriate clinical and legal oversight
- Reference architecture for FHIR + on-chain access control patterns

It is **not** suitable for production clinical use without independent security review, HIPAA compliance audit, and a Business Associate Agreement (BAA) with all involved parties. See `SECURITY.md` (forthcoming) for the threat model.

## Quick start (work in progress)

```bash
# Off-chain stack: API server + dashboard + Firestore emulator
docker-compose up

# On-chain stack: Solana localnet + program deploy
cd packages/vault-programs
anchor localnet
anchor deploy

# Seed demo data
npm run seed
```

A contributor should be able to run the dashboard end-to-end against `localnet` without owning real SOL or a real wallet. If that is not currently true on `main`, please open an issue.

## Documentation

- [`docs/whitepaper.md`](docs/whitepaper.md) — Technical whitepaper covering architecture, cryptographic foundations, clinical algorithms, integration strategy, and regulatory pathway.
- [`docs/workflow-simulations.md`](docs/workflow-simulations.md) — Simulated clinical workflows (nurse routing, scribe, BCMA, emergency access).

## Contributing

Contributions, security review, and pilot proposals are welcome. Please open an issue before sending a large PR so we can discuss scope.

We are particularly interested in:

- FHIR R4 conformance testing and Inferno suite integration
- Independent review of `shield-encryption` (Shamir, proxy re-encryption, HD keys)
- Hospital pilot partners (under appropriate IRB / compliance review)
- Anchor program audits

## License

GNU Affero General Public License v3.0 or later. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).

The AGPL is a strong copyleft license. In short:

- **You may** use, study, modify, and redistribute MediHive freely.
- **You must** keep this software (and any modifications you distribute or operate as a service) under the same AGPL-3.0 license.
- **You must** make complete corresponding source code available to all users of any modified version you operate as a network service.
- **You may not** take MediHive private, fork it into a closed commercial product, or otherwise enclose it.

If you have a use case that requires different terms (e.g. embedding MediHive into a closed-source commercial product), open an issue to discuss commercial dual-licensing.

> MediHive is an open-source reference implementation. The project authors and contributors make no warranty, express or implied, regarding fitness for clinical use. Deployment in any clinical setting is the sole responsibility of the deploying organization.
