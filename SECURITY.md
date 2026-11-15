# Security Policy

## Reporting a Vulnerability

We take the security of Nirium Protocol seriously. If you believe you have found a security vulnerability, please report it responsibly.

### How to Report

**Email:** niriumprotocol@gmail.com

Please include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact assessment
- Any suggested remediation

### What to Expect

| Timeline | Action |
|----------|--------|
| **24 hours** | Acknowledgement of your report |
| **72 hours** | Initial assessment and triage |
| **7 days** | Detailed response with remediation plan |
| **30 days** | Target resolution for critical issues |

### Scope

**Update, 2026-10-23:** this table previously listed Nirium's Soroban contracts, Next.js frontend, Express API and agent scripts - none of which live in this repo. This package is a thin TypeScript adapter; the actual surface in scope here is:

| Component | Status | Notes |
|-----------|--------|-------|
| **`createNiriumAdapter` / `x402Fetch`** | In scope · internal review only, no external audit | Negotiates the 402, signs through the configured signer, retries |
| **`createPollarSigner` / `signAuthEntry` translation** | In scope · internal review only, no external audit | Converts between stellar-sdk's `HashIdPreimage` and Pollar's `SorobanAuthorizationEntry` |
| **`activateWallet`** | In scope · internal review only, no external audit | Server-side only; requires the caller's own secret key |
| **`anchorOnTransactionSuccess`** | In scope · internal review only, no external audit | Anchors only `chain`, `network`, `hash` and `observedAt`; never throws into Pollar's listener |

**Update, 2026-11-15:** the status column above previously read "✅ Internal review passed". A review by our own team is not a pass from anyone independent, so it now says what it is.

Nirium's Soroban contracts, agent API and frontend are in scope of their own repos ([`nirium-core`](https://github.com/nirium-protocol/nirium-core), [`nirium`](https://github.com/nirium-protocol/nirium)), not this one - report issues there against those components instead.

### Out of Scope

- Third-party services (Stellar network, Soroban runtime, Ollama, LLM providers)
- Social engineering attacks against team members
- Denial of service attacks against testnet infrastructure
- Issues in dependencies that are already publicly disclosed

## Audit Status

> **⚠️ IMPORTANT: Nirium smart contracts have NOT been formally audited by any third-party security firm.**

**Update, 2026-10-23 (checked against this repo's own README that day):** this section previously said the protocol "is currently deployed on Stellar Testnet only and uses test tokens with no monetary value" - that contradicted this README's own "live on Stellar mainnet" claim. The corrected picture:

- **NiriumVault and the other Soroban contracts** (shipped in the `nirium-core` repo, not this one) remain **Stellar Testnet only**, audit-gated, no real funds ever reach them. A formal third-party audit is planned for Month 3 of operations (Soroban layer via SCF Audit Bank; API/server layer independently funded).
- **This adapter's own payment and audit-anchoring surfaces are live on mainnet today**, none of it custodied by a Nirium-held key: the x402 settlement and audit-trail anchoring this package wraps run against Nirium's mainnet agent, signed by the user's own Pollar wallet or keypair (see this README's "Verify it end-to-end today" section for the transaction hashes).

**Internal security review (May 2026):** a self-assessment by the team, not a third-party audit or certification. **Update, 2026-10-12:** this line previously reported an aggregate score ("83/83 vectors PASS, 0 critical, 0 high"). A pass count from our own checklist is not an independent rating, so it is no longer shown. Full report: [INTERNAL_SECURITY_AUDIT.md](https://github.com/nirium-protocol/nirium-core/blob/main/INTERNAL_SECURITY_AUDIT.md) (that file lives in the `nirium-core` repo, not this one).

### Security Measures Currently in Place

**In this package:**
- Non-custodial: the adapter never holds or sees a private key. It signs through the signer you pass (a Pollar wallet or your own SEP-43 signer); the x402 facilitator settles.
- The signature expiry is read from the authorization preimage, never from the clock, so a signature cannot be stretched past what the payer approved (`validityLedgers` defaults to 120, about 10 minutes, when an entry is passed directly).
- `activateWallet` rejects an invalid Stellar `G...` address before any network call, is documented as server-side only, and surfaces Pollar's own error `code` and HTTP `status` instead of guessing.
- `anchorOnTransactionSuccess` anchors only four non-personal fields and deduplicates by hash within the process; a failed anchor goes to `onError` and never breaks Pollar's listener.
- CI runs the type check and 31 tests against `@pollar/core` 0.11.4 and 0.12.0. The Security Gate blocks a merge on any high+ advisory in the installed dependencies (`audit-ci`, no allowlist) and on any committed secret (gitleaks 8.28.0, checksum-verified; whole history on every push to `main`).

**Outside this package:** the Soroban contracts, the agent API and the hosted infrastructure this adapter talks to have their own measures and their own scope, listed in [`nirium-core`'s SECURITY.md](https://github.com/nirium-protocol/nirium-core/blob/main/SECURITY.md) and [`nirium`'s SECURITY.md](https://github.com/nirium-protocol/nirium/blob/main/SECURITY.md). **Update, 2026-11-15:** this section previously copied those lists here, including a database note that had since been resolved upstream; it now links to the source instead of repeating it.

## Responsible Disclosure

We kindly ask that you:
- **Do not** publicly disclose the vulnerability before we've had a chance to address it
- **Do not** exploit the vulnerability beyond what is necessary to demonstrate it
- **Do not** access or modify other users' data
- **Do** provide sufficient detail for us to reproduce and fix the issue

## Recognition

We appreciate the security research community's efforts. Reporters of valid security issues will be acknowledged (with permission) in our security advisories.

## Contact

- **Security issues:** niriumprotocol@gmail.com
- **General inquiries:** niriumprotocol@gmail.com
- **Twitter/X:** [@Niriumstellar](https://x.com/Niriumstellar)

---

*This security policy is effective as of May 12, 2026.*
