# Contributing to MediHive

Thanks for your interest in contributing. MediHive is an open-source reference
implementation of patient-sovereign hospital records. Contributions are welcome
from clinicians, security researchers, healthcare IT staff, and software
engineers alike.

This document describes how to participate.

---

## License

By submitting a contribution to MediHive, you agree that your contribution will
be licensed under the **GNU Affero General Public License v3.0 or later**
(see [`LICENSE`](LICENSE)).

This is a strong copyleft license. Anyone running a modified version of
MediHive as a network service must publish their modified source under the
same license. Please make sure you understand this before contributing — and
make sure any code you submit is something you have the right to release
under AGPL-3.0.

We do not currently require a CLA. We follow the **Developer Certificate of
Origin (DCO)**: every commit must be signed off (`git commit -s`) to attest
that you wrote the change or otherwise have the right to submit it under
AGPL-3.0. See https://developercertificate.org for the full text.

## Scope of contributions we want

In rough order of how excited we are to receive them:

1. **Security review** of `packages/shield-encryption` (Shamir 3-of-5,
   proxy re-encryption, HD key derivation), `vault-programs` (Anchor),
   and the API server's authentication/authorization paths.
2. **FHIR R4 conformance** — Inferno test suite integration, profile
   compliance, edge cases in the bridge adapter.
3. **Hospital pilot reports** — even if you cannot share PHI, anonymized
   workflow notes from real clinical environments are extremely valuable.
4. **Bug fixes and test coverage** — particularly around the `brain-engine`
   acuity scoring, alert triage, and nurse routing.
5. **Local-profile contributions** — the on-prem-only deployment path that
   does not require Solana. Postgres schemas, hash-chained audit, etc.
6. **Documentation** — clinical workflows, deployment runbooks, threat models.

What we are **less likely** to merge without prior discussion:

- New top-level packages
- New blockchain integrations beyond Solana
- Tokenomics, governance tokens, payment rails of any kind
- Marketing/branding changes

If you are unsure whether something fits, **open an issue first** and we can
talk it through before you spend time coding.

## Development setup

### Prerequisites

- Node.js 20+
- npm 10+
- Docker (for local Postgres / Firestore emulator / Solana validator)
- Rust + Anchor 0.32.1 (only required if you are working on `vault-programs`)

### One-time

```bash
git clone https://github.com/tikidragonslayer/MediHive.git
cd MediHive
npm install
cp .env.example .env
```

### Common commands

```bash
npm run dev              # API server (default workspace)
npm run dev:dashboard    # Pulse dashboard (Next.js)
npm run lint             # tsc --noEmit across all workspaces
npm test                 # vitest across all workspaces
npm run build            # production builds
npm run build:programs   # anchor build (requires Rust + Anchor toolchain)
npm run test:programs    # anchor test
```

## Pull request process

1. **Open an issue first** for anything larger than a typo or one-line fix.
2. Fork the repo and create a topic branch (`feat/short-description`,
   `fix/issue-123`, `docs/...`).
3. Keep PRs focused. One logical change per PR.
4. Sign off your commits (`git commit -s`).
5. Make sure `npm run lint` and `npm test` pass locally.
6. In your PR description, explain *why* the change is needed, not just *what*
   it does. Link the issue it resolves.
7. Be patient with review — clinical/security-adjacent code requires careful
   reading. We will not rubber-stamp PRs.

## Reporting bugs

Open a GitHub issue with:

- What you were trying to do
- What you expected to happen
- What actually happened
- Steps to reproduce (smallest possible example)
- Environment (OS, Node version, profile = `onchain` or `local`)

For **security-sensitive bugs**, do not open a public issue. See
[`SECURITY.md`](SECURITY.md) for the disclosure process.

## Code style

- **TypeScript** — strict mode, no `any` without a comment explaining why,
  prefer named exports, prefer `type` over `interface` for data, prefer
  pure functions where reasonable.
- **Rust (Anchor programs)** — `cargo fmt` clean, `cargo clippy` clean,
  every account constraint commented.
- **Commit messages** — imperative mood ("add audit chain", not "added"),
  ~72-char subject line, longer body if context helps.

## Questions?

Open a GitHub Discussion or a draft issue. We would rather hear from you
early than have you guess.
