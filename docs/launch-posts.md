# Launch post drafts

These are drafts for v0.2.0 launch. **Do not post until you have:**

1. Hand-walked the local profile end-to-end on your own machine and
   confirmed the docker-compose path actually boots cleanly
2. Reviewed the threat model claims for accuracy under cold scrutiny
3. Decided how aggressive to be about "production-ready" framing
   (defaulting to conservative — see [`SECURITY.md`](../SECURITY.md))

These drafts are intentionally honest about limitations. Hacker News and
r/healthIT will both reward that and punish overclaiming.

---

## Hacker News (Show HN)

**Title** *(under 80 chars; HN strips emoji)*

```
Show HN: MediHive – self-hostable hospital records, FHIR + AI scribe (AGPL-3.0)
```

**Body** *(plain text; HN does not render markdown — keep paragraphs short)*

```
MediHive is an open-source reference implementation of patient-sovereign
hospital records. Two big ideas, one repo:

  1. Patients own the keys, not the hospital. Records are encrypted with
     patient-controlled keys (Shamir 3-of-5 guardian recovery). The
     hospital sees ciphertext until the patient grants scoped, time-
     limited access.

  2. There are two profiles. MEDIHIVE_PROFILE=local runs entirely on
     Postgres with a hash-chained, append-only audit log — no blockchain
     required, ready to deploy in an on-prem hospital today. MEDIHIVE_
     PROFILE=onchain anchors record hashes, access grants, and the audit
     log on Solana for cross-institution portability and patient-side
     revocation no hospital can override.

The local profile satisfies the HIPAA technical safeguards under
45 CFR §164.312 (audit, integrity, access control) when checkpointed
to WORM storage off-host. It is not, by itself, a HIPAA-compliant
system — compliance is a property of a deployed system, not source
code. SECURITY.md covers the threat model and what we explicitly do
not defend against.

What's in the box: 13 packages including a Whisper-based ambient
scribe (audio stays on premises), FHIR R4 bridge for Epic/Cerner/
MEDITECH, NEWS2 acuity scoring, zone-aware nurse routing, alert
triage to reduce alarm fatigue, Anchor programs for the on-chain
profile, and a Next.js dashboard with role-based portals.

What's honest: this is v0.2.0. The local profile works end-to-end.
The on-chain profile is structured but the SolanaVaultDriver behind
the new interface is a stub — the existing services/blockchain-sync.ts
still uses the old PublicKey-typed types and is mid-migration. The
Anchor programs compile cleanly, but they have not been audited.
Don't deploy this to a real clinic without an independent security
review.

Why we're posting: looking for security reviewers (especially of
shield-encryption and the access-grant scoping logic), FHIR R4
conformance contributors, and pilot partners willing to engage
under proper IRB / compliance oversight.

License is AGPL-3.0. Modified network deployments must publish their
source under the same terms — this is intentional, the project should
not be enclosed by closed commercial forks.

https://github.com/tikidragonslayer/MediHive

Happy to answer questions about architecture, threat model, the
local-vs-onchain split, or anything else.
```

---

## r/selfhosted

**Title**

```
[Project] MediHive: self-hostable hospital records w/ FHIR + AI scribe, optional on-chain layer (AGPL-3.0)
```

**Body**

```markdown
Hey r/selfhosted —

Sharing **MediHive**, an open-source hospital records / EHR-adjacent
project I just released v0.2.0 of: https://github.com/tikidragonslayer/MediHive

The reason I'm cross-posting here: most healthtech "open source" lands
as either token-shilling crypto plays or vendor-locked SaaS pretending to
be self-hostable. This is neither. It's AGPL-3.0, runs on Postgres,
deploys with `docker compose`, and the AI scribe keeps audio on premises.

### What it does

- **MediBridge** — FHIR R4 bridge that bolts onto Epic, Cerner, or
  MEDITECH without disrupting the existing EHR. You can deploy MediHive
  alongside, not in place of.
- **MediScribe** — Whisper-based ambient transcription → structured
  SOAP notes. Audio never leaves the hospital network.
- **MediBrain** — NEWS2 acuity scoring, zone-aware nurse routing,
  contextual alert triage to reduce alarm fatigue.
- **MediShield** — Shamir 3-of-5 key splitting, BIP-44 HD keys, proxy
  re-encryption.
- **Pulse Dashboard** — Next.js, role-based portals.
- **Hash-chained audit log** — `SHA-256(prevHash || canonical(payload))`
  over append-only Postgres rows, with WORM-checkpoint export so
  database-admin tampering is detectable from off-host.

### Two profiles, one repo

| | `local` | `onchain` |
|---|---|---|
| Backend | PostgreSQL | Solana + IPFS/Arweave |
| Wallet required | No | Yes |
| Deploy | `docker compose -f infra/docker-compose.local.yml up` | See `docs/profiles.md` |
| Best for | Most hospitals starting today | Sovereign-records pilots |

Pick at process start with `MEDIHIVE_PROFILE=local|onchain`. The on-prem
crowd here will probably want `local`.

### Honest status

This is v0.2.0. The local profile boots and the audit-chain primitive is
test-covered, but I would not deploy it to a real clinic without an
independent security review, a HIPAA risk assessment, and a BAA. SECURITY.md
covers the threat model and where it explicitly does not defend you.

License is AGPL-3.0 — anyone running a modified version as a service must
publish their changes under the same license. No closed forks.

Happy to answer questions, take feature requests, or merge PRs.
```

---

## r/healthIT

**Title**

```
Open-source FHIR + AI scribe + on-prem audit chain (and an opt-in patient-sovereign onchain layer) — feedback wanted from healthIT folks
```

**Body**

```markdown
Posting here for feedback from people who actually live inside hospital
IT, not just devs guessing what hospitals want.

I just released **MediHive** v0.2.0: https://github.com/tikidragonslayer/MediHive

The premise: a single open-source project that bolts onto an existing
EHR via FHIR R4 and adds (a) an ambient AI scribe with audio that stays
on-premises, (b) a tamper-evident audit log with WORM-checkpointed
hash-chain for HIPAA §164.312 integrity, and (c) an *optional* on-chain
patient-sovereign layer for hospitals or pilots that want patient-held
record portability across institutions.

Most hospitals will want the **local** profile (Postgres only, no
blockchain). The onchain profile is for sovereignty pilots, not
mainstream production.

What I want from this thread:

1. **What does MediHive get wrong about real hospital workflows?**
   I have implementation, I do not have 30 years inside a clinical
   environment. If something in `docs/workflow-simulations.md` reads
   like a developer's fantasy, please tell me.
2. **Is the FHIR R4 bridge useful, or is the integration story actually
   harder than the README implies?**
3. **Audit log integrity** — is hash-chained Postgres + WORM export
   enough for §164.312 in practice, or do real auditors push back?
4. **AGPL-3.0** — does this license disqualify it from your shop, or
   is the copyleft fine because you're not redistributing modifications?

Code is at the repo above. Threat model and compliance posture
are in `SECURITY.md`. I am explicitly not claiming this is a
production-ready EHR — it is a reference implementation looking
for engagement before it grows up.
```

---

## Notes for posting

- HN: post Tuesday or Wednesday morning Pacific time. Don't tag
  Anthropic. Reply to the first 5–10 comments fast, then taper.
- r/selfhosted: cross-post around lunchtime UTC for max EU+US overlap.
  Mods are friendly to legitimate self-hostable projects but allergic
  to anything resembling an ad. The license, the docker-compose, and
  the "no closed forks" line all help.
- r/healthIT: smaller subreddit, but the feedback density is higher.
  Don't expect upvote volume; expect 2-3 detailed replies that are
  worth more than a hundred HN points.
