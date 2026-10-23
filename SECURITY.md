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
| **`createNiriumAdapter` / `x402Fetch`** | ✅ Internal review passed | Negotiates the 402, signs through the configured signer, retries |
| **`createPollarSigner` / `signAuthEntry` translation** | ✅ Internal review passed | Converts between stellar-sdk's `HashIdPreimage` and Pollar's `SorobanAuthorizationEntry` |
| **`activateWallet`** | ✅ Internal review passed | Server-side only; requires the caller's own secret key |

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

**Smart Contract Layer (Soroban):**
- `require_auth` on all state-modifying contract functions
- `checked_*` arithmetic throughout (no silent overflow)
- `max_execution_amount` cap per agent delegation - hard physical limit
- Emergency multisig pause: 2-of-3 pattern (admin + cosigner) via `pause()` / `unpause()`
- Agent kill switch: `revoke_agent()` callable even while contract is paused
- Persistent storage TTL extensions (~2 years) on every interaction (SC-TTL-001)
- Admin-signed `initialize()` to prevent front-running at deployment
- Strategy Marketplace: canonical USDC token address stored at init (token-spoofing fix)

**API Layer:**
- JWT: HS256, 1h expiry, RBAC tiers (public / sandbox / institutional / admin)
- API keys stored as SHA-256 hash only - irrecoverable after issuance
- `timingSafeEqual` for all key comparisons
- SQL injection guards on all query params
- Prompt injection sanitization on all LLM inputs
- Prototype pollution guard
- HMAC-SHA256 webhook signature validation
- Sliding-window rate limiting (60/30/300 rpm by tier)
- domainLock and response obfuscation modules exist in the main agent's repo but are not mounted on any route. **Update, 2026-10-23:** this line previously also listed "AML screening" as a live control; that middleware was never imported or mounted on any route and has been removed as dead code (none of this is in this repo's own code either way, see the Scope note above).

**Infrastructure:**
- Row Level Security (RLS) on all Supabase tables - **Update, 2026-10-23 (checked against the live project that day, read-only HEAD requests with no row content fetched):** this line was false for six tables (`auth_keys`, `payroll_runs`, `treasury_vaults`, `security_events`, `sandbox_accounts`, `sandbox_usage`), all readable in full by the public anon key the browser ships, because the agent's own backend used that same anon key for privileged access and their RLS policies were left permissive to compensate. The agent's database client has been switched to the service_role key (which does not depend on RLS at all); a migration to remove the permissive policies and restrict those six tables to `service_role` is prepared but not yet applied to the live project as of this update. Tables that stay intentionally open to anon (`logs`, `agent_logs`, `nirium_swarm_agents`, `strategies`, `nirium_protocol_records` - the public verifiable feed; `vault_delegations`'s anon insert/update/active-only-select, a documented design relying on on-chain signature verification, not RLS; `nirium_llm_config`, documented as holding no sensitive data) are not covered by this line and were not changed.
- Non-custodial architecture - users retain sole key control
- HMAC-SHA256 signed immutable audit trail per agent action
- x402/MPP payment validation middleware on all premium routes
- `legalShield` middleware: TOS consent check via `x-stellar-account` header

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
- **Twitter/X:** [@NiriumXYZ](https://x.com/Niriumstellar)

---

*This security policy is effective as of May 12, 2026.*
