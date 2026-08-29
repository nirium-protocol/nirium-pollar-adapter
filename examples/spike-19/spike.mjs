// Spike for pollar-apps#19 — "Nirium adapter: pay per API request with a
// Pollar account (x402) and ship demo.pollar.xyz/adapters/nirium".
//
// Blocking criterion from the issue: one Pollar social-login session,
// createPollarSigner() from nirium-pollar-adapter, one x402 request paid
// and settled against an x402-enabled endpoint, transaction hash captured.
//
// Rewritten against the REAL @pollar/core@0.11.2 API, verified against its
// .d.ts before writing a line of this: PollarClient's auth surface is
// event-driven (sendEmailCode/verifyEmailCode return void, not Promise) —
// state comes through onAuthStateChange(cb) as a discriminated union keyed
// by `step` (idle → sending_email → entering_code → verifying_email_code →
// authenticating → authenticated | error). The previous version of this
// script assumed a Promise-returning login()/verifyEmailCode() pair that
// does not exist in the installed SDK and would have hung or thrown.
//
// Still not fully scriptable: a human has to read the 6-digit code from
// their inbox. This version doesn't block on stdin (there's no live
// terminal attached when run in the background) — it polls a code file
// instead, so the OTP can be dropped in from a separate step once it
// arrives by email.
//
// Run with: node spike.mjs
//
// Env required (get PUB_KEY from https://dashboard.pollar.xyz → Build → API Keys):
//   POLLAR_PUBLISHABLE_KEY=pub_testnet_...
//   POLLAR_LOGIN_EMAIL=you@example.com
//   POLLAR_CODE_FILE=/tmp/pollar-otp-code.txt   (optional, this is the default)

// Must be the first import — see browser-polyfill.mjs for why this can't
// just be inline code above the @pollar/core import in this same file.
import "./browser-polyfill.mjs";

import { PollarClient, createMemoryAdapter } from "@pollar/core";
import { createPollarSigner, createNiriumAdapter } from "../../dist/index.js";
import { readFile, unlink } from "node:fs/promises";

const CODE_FILE = process.env.POLLAR_CODE_FILE || "/tmp/pollar-otp-code.txt";
const CODE_POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 min to relay the OTP
const CODE_POLL_INTERVAL_MS = 2000;

/** Resolve once the auth state reaches `targetStep`, reject on `step: 'error'`. */
function waitForAuthStep(pollar, targetStep) {
  return new Promise((resolve, reject) => {
    const unsubscribe = pollar.onAuthStateChange((state) => {
      console.log("[auth state]", state.step);
      if (state.step === targetStep) {
        unsubscribe();
        resolve(state);
      } else if (state.step === "error") {
        unsubscribe();
        reject(new Error(`Pollar auth error (was expecting "${targetStep}"): ${state.message} [${state.errorCode}]`));
      }
    });
  });
}

/** Poll CODE_FILE until it has content, then delete it so a stale code can't be reused. */
async function waitForCodeFile() {
  console.log(`Waiting for the 6-digit code in ${CODE_FILE} (write it there once you have it)...`);
  const deadline = Date.now() + CODE_POLL_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const raw = (await readFile(CODE_FILE, "utf8")).trim();
      if (raw) {
        await unlink(CODE_FILE).catch(() => {});
        return raw;
      }
    } catch {
      // File doesn't exist yet — keep polling.
    }
    await new Promise((r) => setTimeout(r, CODE_POLL_INTERVAL_MS));
  }
  throw new Error(`Timed out after ${CODE_POLL_TIMEOUT_MS}ms waiting for ${CODE_FILE}`);
}

async function main() {
  const apiKey = process.env.POLLAR_PUBLISHABLE_KEY;
  const email = process.env.POLLAR_LOGIN_EMAIL;
  if (!apiKey || !email) {
    console.error("Set POLLAR_PUBLISHABLE_KEY and POLLAR_LOGIN_EMAIL first.");
    process.exit(1);
  }

  const pollar = new PollarClient({
    apiKey,
    stellarNetwork: "testnet",
    storage: createMemoryAdapter(),
  });

  await pollar.ready();

  // sendEmailCode() throws PollarFlowError unless the current step is
  // 'entering_email' — that step only exists after beginEmailLogin() runs
  // (idle -> creating_session -> entering_email). Skipping straight to
  // sendEmailCode() is the second bug the server-side no-op guard was
  // masking in the previous version of this script.
  console.log("Starting email login...");
  const enteringEmail = waitForAuthStep(pollar, "entering_email");
  pollar.beginEmailLogin();
  await enteringEmail;

  console.log(`Sending OTP to ${email}...`);
  const enteringCode = waitForAuthStep(pollar, "entering_code");
  pollar.sendEmailCode(email);
  await enteringCode;

  const code = await waitForCodeFile();

  console.log("Verifying code...");
  const authenticated = waitForAuthStep(pollar, "authenticated");
  pollar.verifyEmailCode(code);
  const authState = await authenticated;
  console.log("Authenticated. verified:", authState.verified);

  const signer = createPollarSigner(pollar, { network: "stellar:testnet" });
  console.log("Signer address:", signer.address);

  const nirium = createNiriumAdapter({
    signer,
    network: "stellar:testnet",
    agentBaseUrl: "https://nirium-agent.fly.dev",
  });

  console.log("Requesting /api/v1/premium/signals (expect 402, then auto-pay + retry)...");
  // Using x402Fetch directly (not the getPremiumSignals() shortcut) so we can
  // inspect the raw response headers — the settlement tx hash comes from
  // @x402/express's own machinery, not from Nirium's code, and the exact
  // header name isn't pinned down anywhere in this repo. Log everything and
  // find it empirically rather than guessing a header key.
  const res = await nirium.x402Fetch(`${nirium.agentBaseUrl}/api/v1/premium/signals`);
  console.log("Response status:", res.status);
  console.log("Response headers:");
  for (const [key, value] of res.headers.entries()) {
    console.log(`  ${key}: ${value}`);
  }
  const body = await res.json();
  console.log("Body:", body);

  console.log("Done. Find the settlement tx hash in the headers above, verify it resolves on stellar.expert before including it in the PR.");
}

main().catch((err) => {
  console.error("Spike failed:", err);
  process.exit(1);
});
