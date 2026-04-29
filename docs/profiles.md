# Choosing a profile

MediHive runs in one of three profiles. The application code, FHIR
adapter, AI scribe, dashboard, and clinical algorithms are identical
between them. The only difference is the **VaultDriver** that backs
patient passports, records, grants, consent, and audit.

| Profile | Use this when… |
|---|---|
| `local` | You're a hospital running on Postgres with no on-chain ambitions. Simplest, fastest, no wallet. |
| `federated` | You're a hospital running on Postgres but want to **read** patient-curated records that the patient has stored on Solana. Hospitals never write on-chain; the patient owns the keys. **This is the recommended profile for most hospitals once they have at least one patient with an on-chain passport.** |
| `onchain` | You're running a sovereign-records pilot or you're a patient-side service. Reads work; writes are on the v0.5 roadmap. |

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

## `MEDIHIVE_PROFILE=federated` — Postgres + read-only on-chain

The hybrid profile. The hospital runs Postgres for everything it writes,
and additionally serves **read-only** patient-curated records from
Solana when the patient has signed a bridge between their on-chain
wallet and the hospital's local passport.

| Property | Federated profile |
|---|---|
| Backend | PostgreSQL 16+ (writes) + Solana RPC (reads) |
| Patient identity | Local UUID for hospital records; on-chain wallet for sovereign records; bridged at the front desk |
| Hospital writes | Local only — never writes to the patient's on-chain side |
| Cross-hospital portability | Native: patient walks into any federated hospital, signs the bridge, and that hospital sees prior on-chain records |
| Patient revocation | Patient signs `DELETE /api/patient/v2/bridge/:id` from wallet — hospital immediately stops reading on-chain |
| Type allowlist | Per-bridge `onchain_record_types` array — patient declares which record categories the hospital may read |
| Wallet required? | Patient yes, hospital no |
| RPC failure mode | Local reads continue; on-chain reads silently degrade (logged) |

### How a bridge gets created

1. Patient generates an on-chain passport on Solana via the mobile app.
2. Patient walks into Hospital X for the first time. Front desk creates a local Postgres passport.
3. Front-desk terminal shows a QR code containing the local passport UUID.
4. Patient's mobile wallet signs a canonical JSON envelope:
   ```json
   {"localPassportId":"…","nonce":"…","onchainPassportId":"…","timestamp":1700000000}
   ```
   Keys sorted lexicographically, no whitespace, RFC 8785 style.
5. Front-desk terminal POSTs to `/api/patient/v2/bridge` with the signed payload.
6. Server verifies the Ed25519 signature against the on-chain pubkey, checks the timestamp is within ±5 minutes (configurable), and inserts a non-revoked row in `patient_bridges`.
7. Forever after, when this hospital's clinicians read the patient's records, the federated driver merges local Postgres rows with the on-chain records the patient has explicitly authorized for this hospital.

### Trust model

- Hospital cannot forge a bridge: the on-chain pubkey must produce a valid signature over the canonical envelope.
- Patient cannot link someone else's wallet: `auth.pubkey === onchainPassportId` is enforced by the API endpoint, in addition to the signature check.
- Replay is blocked by the timestamp window plus the unique nonce constraint at the SQL level.
- Revocation is honored immediately — `findByLocal` filters on `revoked_at IS NULL`, and revocation is one row update.
- On-chain RPC failures don't break clinical workflows: the federated driver wraps on-chain calls in try/catch and returns local-only results if the RPC is unavailable.

### Limits

- Hospital cannot **write** to the on-chain side. The patient owns their wallet's private key. Anything that requires a write — minting a new on-chain record, revoking a grant the patient holds on-chain — must go through the patient's mobile app.
- Pagination across the merged dataset is currently best-effort: the federated driver returns an opaque `nextCursor` of `'federation-cursor-not-yet-supported'` when more results exist. Callers that need real pagination should query each side directly.
- The federated `verifyAuditChain` is the local-side hash chain only. On-chain audit integrity comes from Solana consensus, not from a hash chain — there's nothing meaningful to "verify" client-side.

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
