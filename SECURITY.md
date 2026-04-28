# Security Policy

MediHive handles protected health information (PHI) by design. Security
issues are taken seriously and reviewed as a priority over feature work.

## Reporting a vulnerability

**Do not open a public GitHub issue for security-sensitive bugs.**

Instead, use one of these private channels:

- GitHub's private security advisory: https://github.com/tikidragonslayer/MediHive/security/advisories/new
- Email: opening a GitHub security advisory is preferred. If you cannot, you may file a draft issue marked confidential.

When reporting, please include:

- A description of the vulnerability and its impact
- Steps to reproduce (proof-of-concept code is helpful but not required)
- Any known mitigations
- Whether you would like public credit when the issue is disclosed

We will acknowledge receipt within **72 hours** and aim to provide an initial
assessment within **7 days**. Coordinated disclosure timelines are negotiated
based on severity, but we typically target **90 days** from initial report
to public disclosure.

We do not currently offer a paid bug bounty. We will, however, credit
reporters in the corresponding security advisory and the project changelog
unless they request anonymity.

## Scope

### In scope

- Cryptographic flaws in `packages/shield-encryption` (Shamir 3-of-5,
  proxy re-encryption, BIP-44/SLIP-0010 key derivation)
- Authentication/authorization bypass in `packages/api-server`
- Solana program bugs in `packages/vault-programs` (any of the 5 Anchor
  programs: patient_passport, record_manager, access_grants,
  consent_registry, audit_logger)
- Audit log integrity — any way to tamper with or forge audit entries
  without detection
- Access grant scoping bugs — any way to access PHI outside an active
  grant's stated scope, role, or duration
- Patient passport recovery flow — any way to bypass Shamir threshold
  to take over a patient's identity
- Consent forgery — any way to forge or replay consent receipts
- Information disclosure in error responses or logs
- SQL/NoSQL injection, prototype pollution, deserialization bugs
- SSRF, RCE, path traversal in any first-party code

### Out of scope (please do not file)

- Vulnerabilities in third-party dependencies — please report to the
  upstream project, then open a non-security PR here to bump the
  pinned version
- Social engineering of project maintainers
- DoS attacks against demo deployments
- Reports requiring physical access or compromised endpoint devices
  unless there is a relevant mitigation we should add
- "Best practice" recommendations without a concrete attack vector
  (open a regular issue or PR for those)

## Threat model (summary)

MediHive's design assumes the following adversaries:

| Adversary | Capability | Mitigation |
|---|---|---|
| Curious hospital insider | Database read access | PHI encrypted at rest with patient-controlled keys; insider sees ciphertext only |
| Malicious clinician | Valid credential, but no active grant | Access checks at API + program level; audit log captures every attempt |
| Compromised hospital server | Full server compromise | Patient keys never decrypted server-side without an active grant; on-chain audit log makes silent exfiltration evident |
| Network attacker | TLS-on-the-wire | mTLS or strong TLS 1.3, signed FHIR bundles, replay protection on grants |
| Compromised patient device | Wallet theft | Shamir 3-of-5 guardian recovery; passport revoke-and-rotate |
| Cloud storage compromise | IPFS/Arweave gateway compromise | Content-addressed storage + on-chain hash means tampered records fail integrity check |

What MediHive does **not** defend against:

- A compromised patient device with the unlocked wallet present (the
  patient is, by definition, the root of trust for their own records)
- A coalition of guardians ≥ Shamir threshold colluding against the patient
- Solana network-level attacks (we inherit Solana's threat model for
  on-chain components; off-chain components are independently designed)
- Deployments that disable or misconfigure the access-control layer

If your finding is in the "does not defend against" column but you believe
it should be in the defended column, that is a great topic for an issue.

## Compliance posture

MediHive is an **open-source reference implementation**. It is not, by
itself, HIPAA-compliant — compliance is a property of a deployed system
and the organization deploying it, not of source code. We have designed
MediHive to *enable* HIPAA-compliant deployment (audit controls, integrity,
access control, transmission security) but the deploying organization is
responsible for:

- A signed Business Associate Agreement (BAA) with all involved parties
- HIPAA-compliant infrastructure hosting (BAA-eligible cloud or on-prem)
- Workforce training, sanctions policy, breach response procedures
- Independent security risk assessment under 45 CFR §164.308(a)(1)(ii)(A)

**Never deploy MediHive in a clinical setting without independent security
review and legal counsel.**
