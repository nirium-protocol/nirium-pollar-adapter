# Contributing to nirium-pollar-adapter

Thank you for your interest in contributing. This repository holds the Nirium adapter for the Pollar SDK — a single TypeScript package published as `nirium-pollar-adapter` on npm. It does not contain Nirium's agent runtime or Soroban contracts, which are maintained privately.

> **Note:** Nirium operates under the [Stellar Code of Conduct](https://github.com/Eras256/Nirium/blob/main/CODE_OF_CONDUCT.md). Violations can be reported to [niriumprotocol@gmail.com](mailto:niriumprotocol@gmail.com) or [community@stellar.org](mailto:community@stellar.org).

---

## Development Setup

### Prerequisites

- Node.js 20+
- Git

### Getting Started

```bash
git clone https://github.com/nirium-protocol/nirium-pollar-adapter.git
cd nirium-pollar-adapter
npm install
npm run build
```

### Package Scripts

| Script | Description |
|--------|-------------|
| `npm run build` | Compile TypeScript (`tsc`) |
| `npm run typecheck` | Type-check without emitting |

---

## Repository Structure

```
nirium-pollar-adapter/
├── src/          → Adapter source (published as dist/ on npm)
├── examples/     → Runnable integrations (keypair signer, Pollar social-login spike)
└── README.md     → Install, quickstart, API reference
```

---

## Contribution Guidelines

### Pull Requests

1. Fork the repository
2. Create a feature branch: `git checkout -b feat/my-feature`
3. Make your changes
4. Run `npm run typecheck` for the change you made
5. Commit using conventional commits (see below)
6. Push and open a PR against `main`

Reviewers will not follow up for missing context — include a clear description of what changed and why.

### Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

| Prefix | Use for |
|--------|---------|
| `feat:` | New feature |
| `fix:` | Bug fix |
| `docs:` | Documentation only |
| `refactor:` | Code change that neither fixes a bug nor adds a feature |
| `test:` | Adding or updating tests |
| `chore:` | Maintenance, tooling, CI |

### AI Assistance Disclosure

Every commit produced with AI assistance carries a `Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>` trailer. This is a factual disclosure of how the commit was produced — it is never stripped to make a commit look human-authored, and never added where it doesn't apply to fake the opposite. If you use AI assistance in your own contributions, disclose it the same way.

### Code Style

- **TypeScript:** strict mode, explicit types for all public APIs
- **Comments:** only when the *why* is non-obvious — no narration of what the code does

---

## Security

If you discover a security vulnerability, **do not open a public issue.**

Email: **niriumprotocol@gmail.com**

Include: description, reproduction steps, potential impact, and any suggested remediation.

---

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](LICENSE).

---

*Created August 29, 2026*
