# Choosing a profile

MediHive runs in one of two profiles. The application code, FHIR adapter,
AI scribe, dashboard, and clinical algorithms are identical between them.
The only difference is the **VaultDriver** that backs patient passports,
records, grants, consent, and audit.

## `MEDIHIVE_PROFILE=local` — Postgres-backed, on-prem

Designed for hospitals that need HIPAA technical safeguards today and are
not ready for on-chain anchoring.

| Property | Local profile |
|---|---|
| Backend | PostgreSQL 16+ |
| Patient identity | Postgres `patient_passports` row, hospital-internal UUID |
| Record integrity | Content-addressed storage + DB row constraints |
| Access control | DB-side access grants with TTL + role scope |
| Consent | Ed25519-signed canonicalized consent receipts |
| Audit integrity | Hash-chained `audit_log` (SHA-256 over canonical JSON) + nightly WORM checkpoint |
| Patient key custody | Local KMS / hospital HSM (suggested) |
| Network requirements | None beyond hospital LAN |
| Wallet required? | No |
| Crypto/Web3 literacy required? | No |
| Cross-hospital portability | Manual FHIR export only |
| Deployment | `docker compose -f infra/docker-compose.local.yml up` |

This profile satisfies HIPAA technical safeguards (45 CFR §164.312):

- **Unique user identification:** every actor has a stable Identity string
- **Audit controls:** hash-chained `audit_log`, append-only at the SQL level
- **Integrity:** SHA-256 chain detects any tampering, including by DB admins, when checkpoints are exported off-host
- **Person-or-entity authentication:** delegated to the API server's auth layer
- **Transmission security:** TLS 1.3 end-to-end (operator's responsibility)

## `MEDIHIVE_PROFILE=onchain` — Solana-anchored, patient-sovereign

Designed for deployments where patient data sovereignty across providers
is the central goal. The patient's wallet is the ultimate authority over
their record.

| Property | On-chain profile |
|---|---|
| Backend | Solana + IPFS/Arweave (PHI off-chain, hashes on-chain) |
| Patient identity | Soul-Bound Token (non-transferable Solana NFT) |
| Record integrity | Solana program enforces immutability; off-chain ciphertext is content-addressed |
| Access control | On-chain access grant accounts, time-windowed and role-scoped |
| Consent | On-chain consent registry, revocation cascades to grants |
| Audit integrity | Compressed NFT audit log on Solana (~$0.000005 per entry) |
| Patient key custody | Patient wallet + Shamir 3-of-5 guardian recovery |
| Network requirements | Solana RPC connection (devnet, testnet, or mainnet) |
| Wallet required? | Yes — patients need a Solana wallet (or hospital-managed custodial wallet) |
| Crypto/Web3 literacy required? | Yes (or hospital handles custody) |
| Cross-hospital portability | Native — passport + grants are portable across any MediHive deployment |
| Deployment | `docker compose -f infra/docker-compose.yml up` + `anchor localnet` for dev |

This profile additionally provides:

- **Cross-institution portability** out of the box
- **Patient-side revocation** that no hospital can override
- **Tamper-evidence by default** — no off-host checkpointing required
- **No reliance on hospital DB integrity** for access control

## Migration path

Hospitals can start on `local` and graduate to `onchain` later. Records
remain in their FHIR R4 form throughout, so the migration is a one-way
re-anchoring, not a re-modeling of clinical data. We do not yet ship a
turnkey migration tool — open an issue if this matters to you.

## Comparison at a glance

| | local | onchain |
|---|:-:|:-:|
| Works without a wallet | ✅ | ❌ |
| Cross-hospital records | partial (FHIR export) | native |
| Patient-side revocation | via portal | via wallet |
| Tamper-evident audit | ✅ (with WORM export) | ✅ (default) |
| Detects DB-admin tampering | ✅ (with WORM export) | ✅ |
| Self-hostable | ✅ | ✅ |
| Recommended starting point | most hospitals | research/pilot/sovereign-records advocates |
