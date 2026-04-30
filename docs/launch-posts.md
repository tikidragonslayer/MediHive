# Launch post drafts (v0.5.0)

Drafts for the public launch. **Do not post until you have:**

1. Booted the local profile end-to-end on your own machine and confirmed `./scripts/demo.sh` runs cleanly start to finish
2. Recorded `scripts/demo.sh` via QuickTime and uploaded the file (link from the post and the README)
3. Reviewed the threat-model claims in `SECURITY.md` for accuracy under cold scrutiny
4. Decided how aggressive to be about "production-ready" framing (default: conservative)

These drafts are intentionally honest about limitations. Hacker News and r/healthIT will reward that and punish overclaiming.

---

## Hacker News (Show HN)

**Title** *(under 80 chars; HN strips emoji)*

```
Show HN: MediHive – self-hostable hospital records (Postgres + optional Solana)
```

**Body** *(plain text; HN does not render markdown — keep paragraphs short)*

```
MediHive is an open-source hospital records / EHR-adjacent reference
implementation. The thesis: patients hold the keys, hospitals run
ordinary Postgres, and the bridge between them is a patient-signed
Ed25519 envelope.

Three profiles:

  MEDIHIVE_PROFILE=local      Postgres-only. No wallet, no chain, no
                              crypto. HIPAA technical safeguards via
                              hash-chained audit + WORM checkpoint.

  MEDIHIVE_PROFILE=federated  Postgres + read-only Solana. Hospital
                              writes locally; on-chain reads merge in
                              when the patient has signed a bridge.
                              Cross-hospital portability without the
                              hospital running on-chain code.

  MEDIHIVE_PROFILE=onchain    Solana-anchored, patient-sovereign.
                              Reads work; transaction builders are
                              landing per-program (passport ✓,
                              records/grants/consent/audit pending).

Architecture is a single VaultDriver interface. The api-server depends
on the interface, not on @solana/web3.js or pg directly. Profile
selection happens at process start. Federation lets a hospital that
runs the local profile additionally serve patient-curated on-chain
records when the patient has signed a bridge — the patient owns the
wallet, the hospital owns the local DB, neither can fake the other.

Test count is 117 passing across audit-chain, driver, federation,
crypto, two HTTP suites, and the first Anchor transaction-builder
serialization tests. Postgres integration tests run on every PR via
postgres:16-alpine in GitHub Actions.

What's honest: this is v0.5.0. The local profile is fully wired —
every role group (patient, doctor, nurse, admin, pharmacy, lab,
billing, frontdesk) has /api/<role>/v2/* endpoints that go through
the active VaultDriver. The dashboard's /patient page calls those
endpoints end-to-end. The federation profile is wired and tested.
The on-chain profile reads work; writes throw NOT_YET_WRITES for
every program except patient passport.

What's NOT done: HTTP integration tests for 6 of the 8 routes are
the next chunk. End-to-end devnet smoke testing requires solana-test-
validator + deployed Anchor programs, which I haven't done. The
shield-encryption layer (Shamir 3-of-5 + proxy re-encryption + HD
keys) has 48 tests but no independent security review.

License is AGPL-3.0. Modified network deployments must publish their
source. This is intentional — patient-records tooling shouldn't be
enclosable by a closed commercial fork.

https://github.com/tikidragonslayer/MediHive

Looking for: security reviewers (especially shield-encryption and
the bridge signature path), FHIR R4 conformance contributors,
hospital pilot partners under appropriate oversight, and Anchor
developers willing to land the remaining program tx builders.

Demo: scripts/demo.sh — 90-second narrated terminal walkthrough.
```

---

## r/selfhosted

**Title**

```
[Project] MediHive: self-hostable hospital records, AGPL-3.0, runs on Postgres alone (federation with Solana optional)
```

**Body**

```markdown
Hey r/selfhosted —

Sharing **MediHive**, an open-source hospital records / EHR-adjacent reference implementation. v0.5.0 just shipped: https://github.com/tikidragonslayer/MediHive

Most healthtech "open source" lands as either token-shilling crypto plays or vendor-locked SaaS pretending to be self-hostable. This is neither. Three profiles, picked via env var:

| `MEDIHIVE_PROFILE` | Backend | Wallet required |
|---|---|---|
| `local` | Postgres 16 | No |
| `federated` | Postgres 16 + read-only Solana | Patient yes, hospital no |
| `onchain` | Solana + IPFS/Arweave | Yes |

For most r/selfhosted readers, `local` is the answer.

### What it does

- **Patient records** with hash-chained audit log (`SHA-256(prevHash ‖ canonical(payload))`) so DB-admin tampering is detectable when checkpoints are exported off-host
- **Access grants** with TTL + role + record-type scope, enforced at the SQL layer
- **AI medical scribe** (Whisper-based; runs on hospital edge GPUs)
- **FHIR R4 bridge** for Epic, Cerner, MEDITECH
- **8 role-based portals** (patient, doctor, nurse, admin, pharmacy, lab, billing, frontdesk) — every one has `/api/<role>/v2/*` endpoints going through the same VaultDriver interface
- **Pulse dashboard** (Next.js standalone) with a `/patient` route that calls the v2 API and renders passport metadata, records, and the audit chain

### Status

This is v0.5.0. **117 tests passing**, CI runs Postgres integration on every PR. The local profile is fully wired. The federation profile is wired. The onchain profile is read-only-with-the-first-write-builder-shipping.

What I would *not* do: deploy this to a real clinic without independent security review, a HIPAA risk assessment, and a BAA. SECURITY.md covers the threat model and where it explicitly does not defend you.

License is AGPL-3.0 — anyone running a modified version as a service must publish their changes under the same license. No closed forks.

### Try it

```bash
brew install postgresql@16
brew services start postgresql@16
createdb medihive
psql -d postgres -c "CREATE USER medihive WITH PASSWORD 'medihive_dev'; ALTER USER medihive CREATEDB;"

git clone https://github.com/tikidragonslayer/MediHive.git
cd MediHive
npm install
DATABASE_URL=postgres://medihive:medihive_dev@127.0.0.1:5432/medihive \
  npm run migrate --workspace=@medi-hive/local-vault
DATABASE_URL=postgres://medihive:medihive_dev@127.0.0.1:5432/medihive \
  npm test  # 117 passing
```

Or `./scripts/demo.sh` for a 90-second narrated walkthrough.

Happy to take feature requests, merge PRs, hear about real hospital pain points.
```

---

## r/healthIT

**Title**

```
Open-source hospital records w/ FHIR + AI scribe + WORM-checkpointed audit (Postgres-only deploy; optional patient-sovereign on-chain layer) — feedback wanted
```

**Body**

```markdown
Posting here for feedback from people who actually live inside hospital IT, not just devs guessing what hospitals want.

I just released **MediHive** v0.5.0: https://github.com/tikidragonslayer/MediHive

The premise: a single open-source project that bolts onto an existing EHR via FHIR R4 and adds (a) an ambient AI scribe with audio that stays on-premises, (b) a hash-chained audit log designed for HIPAA §164.312 integrity with WORM-checkpoint export, (c) an *optional* patient-sovereign on-chain layer for hospitals or pilots that want patient-held record portability across institutions.

Most hospitals will want the **`local`** profile (Postgres only, no blockchain). The `federated` profile is for hospitals that want to additionally read on-chain records the patient has stored themselves — without the hospital running any on-chain code. The `onchain` profile is for sovereign-records pilots, not mainstream production.

What I want from this thread:

1. **What does MediHive get wrong about real hospital workflows?** I have implementation, I do not have 30 years inside a clinical environment. If something in `docs/workflow-simulations.md` reads like a developer's fantasy, please tell me.
2. **Is the FHIR R4 bridge useful, or is the integration story actually harder than the README implies?**
3. **Audit-log integrity** — is hash-chained Postgres + WORM export enough for §164.312 in practice, or do real auditors push back?
4. **AGPL-3.0** — does this license disqualify it from your shop, or is the copyleft fine because you're not redistributing modifications?

Code is at the repo above. Threat model and compliance posture are in `SECURITY.md`. I am explicitly not claiming this is a production-ready EHR — it is a v0.5.0 reference implementation looking for engagement before it grows up.

`./scripts/demo.sh` shows the local + federated profiles end-to-end in 90 seconds.
```

---

## Notes for posting

- **HN**: post Tuesday or Wednesday morning Pacific time. Don't tag anyone. Reply to the first 5–10 comments fast, then taper. Have the demo video URL ready before posting — "Show HN: …" + a real recording outperforms text-only by an order of magnitude.
- **r/selfhosted**: cross-post around lunchtime UTC for max EU+US overlap. Mods are friendly to legitimate self-hostable projects but allergic to anything resembling an ad. The license, the docker-compose, and the "no closed forks" line all help.
- **r/healthIT**: smaller subreddit, but the feedback density is higher. Don't expect upvote volume; expect 2–3 detailed replies that are worth more than a hundred HN points.

## Demo recording checklist (do before any of the posts)

1. `brew services start postgresql@16` (verify with `pg_isready`)
2. `cd ~/Projects/MediHive && npm install && npm run build --workspace=@medi-hive/api-server`
3. ⌘⇧5 → "Record selected portion" → drag the terminal window
4. `clear && ./scripts/demo.sh`
5. ⌘⌃⎋ to stop
6. Trim leading/trailing silence in QuickTime: Edit → Trim
7. Save as `~/Projects/MediHive/docs/demo.mp4` (gitignored — host on the GitHub release or a CDN)
8. Add link to README + the launch posts above
