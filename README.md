# nirium-pollar-adapter

Nirium adapter for the [Pollar](https://pollar.xyz) SDK — let the wallet a user onboarded through Pollar pay for APIs (x402) and anchor tamper-proof evidence to IPFS, without your app touching keys or learning the x402 protocol.

Both surfaces are **software-only and non-custodial**, and both are **live on Stellar mainnet**.

## Install

```bash
npm install nirium-pollar-adapter
# optional peer, only for createPollarSigner: @pollar/core >= 0.11
```

## Quickstart

```ts
import { PollarClient } from "@pollar/core";
import { createPollarSigner, createNiriumAdapter } from "nirium-pollar-adapter";

const pollar = new PollarClient({ apiKey: "pub_mainnet_…" });
await pollar.login({ provider: "google" });

const nirium = createNiriumAdapter({
  signer: createPollarSigner(pollar),
  network: "stellar:pubnet",
});

// A normal fetch. The 402, the signature and the retry happen underneath.
const res = await nirium.x402Fetch(
  "https://nirium-agent-mainnet.fly.dev/api/v1/premium/market",
);
const data = await res.json();
```

The user pays **$0.05 USDC** and signs nothing else — network fees are sponsored by the x402 facilitator, so the wallet does not need XLM for gas.

### Requires @pollar/core 0.11+

`createPollarSigner` calls `PollarClient.signAuthEntry`, available from `@pollar/core` 0.11. On older versions it throws an explanatory error, and you can still pass any other SEP-43 signer.

The two sides speak different dialects and the adapter translates between them: x402 expects SEP-43 (`signAuthEntry(xdr, { networkPassphrase, address }) → { signedAuthEntry }`), Pollar expects `signAuthEntry(xdr, { validUntilLedger }) → { status, … }`. The adapter reads the network's latest ledger, sets the expiry, and normalises the outcome — you do not deal with any of it.

```ts
const signer = createPollarSigner(pollar, {
  network: "stellar:pubnet",
  validityLedgers: 120, // ~10 min, the default
});
```

Check at runtime before enabling a pay button:

```ts
import { canSignX402 } from "nirium-pollar-adapter";
<button disabled={!canSignX402(pollar)}>Pay $0.02</button>
```

## Verify it end-to-end today

The signer is pluggable, so you can prove the whole path works with a plain Stellar keypair — no Pollar required:

```bash
NIRIUM_DEMO_SECRET=S… node examples/pay-with-keypair.mjs
```

Verified on mainnet (27 Jul 2026): payment [`25ebaf9a…`](https://stellar.expert/explorer/public/tx/25ebaf9aa7e72c1c3edcc43a1c18aaa102c12eee42c57e02fed4fda79af6605d) settled, evidence anchored at [`QmZiwxidm…`](https://gateway.pinata.cloud/ipfs/QmZiwxidm7pcTqNufxzFyUc7qJrCRN2TKRNwcXkg7vUUwR).

Swapping to a Pollar wallet is one line:

```diff
- const signer = createEd25519Signer(secret, network);
+ const signer = createPollarSigner(pollarClient);
```

**Verified with a real Pollar social login (our own test account, 5 Aug
2026):** a user who signed in with Google paid $0.02 USDC on mainnet —
[`e4fa3df9…`](https://stellar.expert/explorer/public/tx/e4fa3df9cb225a4d7f64dd0082eb38218ada4b4af3378f288989a5d4b1116ed9)
— holding **zero XLM** at any point. Pollar sponsors the account reserve and the
trustline; the x402 facilitator sponsors the network fee and is the transaction
source. The user never saw a key, a seed phrase or a gas prompt.

Both proofs above paid `/premium/signals` ($0.02). Since 6-Aug-2026 that
endpoint is **testnet only** — the mainnet agent box runs no autonomous loop,
so a capability guard now returns 501 before any charge. The example above
pays `/premium/market` ($0.05) instead, which has no such guard and still
settles on mainnet today; the two linked transactions remain real, they are
just no longer reproducible verbatim with the current example.

## Deferred funding (Pollar "Deferred mode")

If your Pollar app's **Dashboard → Treasury → Funding Mode** is set to
**Deferred**, a wallet is created on-chain at login but its XLM reserve is
not funded until your backend calls `POST /v1/wallets/activate`. This
adapter did not call that endpoint until this version — the section above
already shows why it usually does not need to: a wallet at 0 XLM can sign
and settle a real x402 payment (Pollar sponsors the account reserve and the
default trustline; the facilitator sponsors the network fee). Call
`activateWallet()` when you *do* need the account's own reserve — receiving
native XLM, holding subentries Pollar does not sponsor, or just to match
what Pollar's dashboard considers "activated."

```ts
import { activateWallet } from "nirium-pollar-adapter";

// Server-side only (Next.js API route, Express handler, webhook) — never
// call this from the browser, it requires the secret key.
const result = await activateWallet(wallet.address, {
  secretKey: process.env.POLLAR_SECRET_KEY!, // sec_testnet_… / sec_mainnet_…
});
// { activated: true, amount: "1.5" }  — funded now
// { activated: false }                — was already funded; safe, not an error
```

Calling it twice on an already-funded wallet does not throw — Pollar's own
docs call HTTP 409 "safe to ignore, treat as success," and `activateWallet`
returns `{ activated: false }` rather than raising. Anything else throws
`PollarActivationError` with the real `code` and HTTP `status` Pollar sent,
rather than assuming a fixed meaning per status number — the two Pollar docs
pages describing this endpoint disagree with each other on what several of
the non-200/409 codes mean (402 vs. 403, 503 vs. 502 for what reads like the
same failure), so this adapter surfaces what the server actually said
instead of picking one doc to trust.

## API

### `createNiriumAdapter(config)`

| Option | Default | |
|---|---|---|
| `signer` | — | SEP-43 signer. Only `address` and `signAuthEntry` are required |
| `network` | `stellar:testnet` | `stellar:testnet` or `stellar:pubnet` |
| `agentBaseUrl` | box for the network | Nirium agent base URL |
| `rpcUrl` | public RPC for the network | Soroban RPC |
| `fetchImpl` | global `fetch` | for tests or runtimes without global fetch |

Returns:

- **`x402Fetch(url, init?)`** — fetch that pays on `402` and retries. Passes through untouched on `200`.
- **`getPremiumSignals()`** — typed shortcut to the agent's paid signals endpoint. **Testnet only**: signals come from the autonomous loop, which does not run on the mainnet box; there the endpoint returns 501 without charging.
- **`getPremiumMarket()`** — typed shortcut to the agent's paid market-state endpoint ($0.05). Works and charges on **both** networks — no autonomous loop dependency.
- **`anchorAuditRecord({ hash?, record?, txHash?, tag? })`** — anchors evidence to IPFS, returns the CID. No signature, no payment. Anchor **hashes, not personal data** — IPFS cannot be deleted.
- **`getCetesRate()`** — public reference rate, no key required.

### `createPollarSigner(pollarClient, opts?)`

Wraps a Pollar client as a SEP-43 `ClientStellarSigner`.

| Option | Default | |
|---|---|---|
| `address` | read from the client's auth state | payer address, if you already have it |
| `network` | `stellar:testnet` | used to read the latest ledger |
| `rpcUrl` | public RPC for the network | Soroban RPC |
| `validityLedgers` | `120` (~10 min) | only used when you hand it an entry directly |

**`signAuthEntry` means two different things, and this is what translates them.**

`stellar-sdk` (`AssembledTransaction.signAuthEntries` → `authorizeEntry`) hands
the signer a **`HashIdPreimage`** — the thing about to be hashed — and expects
the **raw signature** back; it assembles the final entry itself. Pollar's
`POST /tx/sign-auth-entry` expects the full **`SorobanAuthorizationEntry`** and
returns the **signed entry**, because its backend validates the invocation tree
against your Auth Policy allowlist before signing, and a hash would tell it
nothing. Both designs are right; they are just not the same one.

Without translation Pollar answers `SOROBAN_AUTH_ENTRY_INVALID — "entryXdr is
not a valid SorobanAuthorizationEntry"`, which reads like a corrupt XDR when the
XDR is fine and merely of another type.

The preimage carries nonce, expiry and invocation; the only thing the entry
additionally needs is the signer address, which we have — so the reconstruction
is exact and the hash Pollar signs is byte-identical to the one the SDK expects.
The expiry is taken **from the preimage**, never from the clock: it lives inside
the signed hash, so asking Pollar for a different one would yield a signature
that does not validate.

### `activateWallet(publicKey, options)`

Funds a Pollar wallet's on-chain XLM reserve (`POST /v1/wallets/activate`). **Server-side only.**

| Option | Default | |
|---|---|---|
| `secretKey` | — | `sec_testnet_…` / `sec_mainnet_…`. Never expose this client-side |
| `baseUrl` | `https://api.pollar.xyz` | Pollar Server base URL |
| `fetchImpl` | global `fetch` | for tests or runtimes without global fetch |

Returns `{ activated: boolean, amount?: string }`. Throws `PollarActivationError` (`.code`, `.status`) for anything other than success (200) or already-funded (409). Also throws a plain `Error` synchronously, before any network call, if `publicKey` is not a valid Stellar `G...` address.

### Paying from a browser

Three server-side settings are not optional, and all three fail with messages
that point somewhere else:

| Needed | Otherwise |
|---|---|
| `Access-Control-Expose-Headers: PAYMENT-REQUIRED` | JS cannot read the terms → *"Failed to parse payment requirements"*, which reads as a bad signature |
| `Access-Control-Allow-Headers: PAYMENT-SIGNATURE` | the paid retry never leaves the browser |
| `Access-Control-Allow-Headers: Access-Control-Expose-Headers` | `@x402/fetch` sets that response header **on the request**; without permission the preflight fails |

Client side, `connect-src` must list the resource server, the Soroban RPC and
`sdk.api.pollar.xyz`.

Pollar side: allowlist the USDC SAC with the `transfer` function under
**Treasury → Auth Policy**. Until a contract is listed, every custodial signing
request is rejected.

## Scope

| | |
|---|---|
| x402 Settlement | ✅ mainnet |
| Audit Trail (IPFS) | ✅ mainnet |
| Treasury vault (DeFindex, client-owned) — Nirium signs and executes | ✅ mainnet — invite-only during legal review |
| Treasury vault — propose only, you sign | ✅ mainnet — public, no invite required (`POST /api/treasury/rebalance/propose`, not yet wrapped by this adapter) |
| Nirium's own NiriumVault | audit-gated — testnet only |
| MPP session channels | audit-gated — testnet only |

Nirium never holds customer funds. The user's signature is the authorization; regulated partners execute any financial settlement.

## License

MIT
