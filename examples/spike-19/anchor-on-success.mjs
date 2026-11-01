// Live check for anchorOnTransactionSuccess: one Pollar login, one real testnet
// payment, one Audit Trail receipt for it.
//
// What it does:
//   1. Logs in to a Pollar TESTNET app with an email code (you type the code).
//   2. Gives the Pollar wallet some testnet XLM from a throwaway key funded by
//      friendbot (the throwaway key is never printed or saved).
//   3. Sends 1 XLM back through Pollar's own pipeline (pollar.sendPayment), which
//      makes onTransactionStateChange report { step: "success", hash }.
//   4. anchorOnTransactionSuccess anchors { chain, network, hash, observedAt } in
//      Audit Trail. The script prints the tx hash and the CID.
//
// Testnet only. The receipt is a Nirium self-test: never count it as third-party use.
//
// Env:
//   POLLAR_PUBLISHABLE_KEY=pub_testnet_...   (public key of a testnet Pollar app)
//   POLLAR_LOGIN_EMAIL=you@example.com
//   POLLAR_CODE_FILE=/path/to/file           (optional; if unset, the code is asked in the terminal)
//   POLLAR_ORIGIN=http://localhost:3000     (optional; must be an origin allowed in the Pollar
//                                            app's settings, or session creation fails with ORIGIN_NOT_ALLOWED)
//
// Run from the repo root after `npm run build`:
//   node examples/spike-19/anchor-on-success.mjs

import "./browser-polyfill.mjs";

import { PollarClient, createMemoryAdapter } from "@pollar/core";
import { Keypair, Horizon, TransactionBuilder, Operation, Asset, Networks, BASE_FEE } from "@stellar/stellar-sdk";
import { createPollarSigner, createNiriumAdapter, anchorOnTransactionSuccess } from "../../dist/index.js";
import { readFile, unlink } from "node:fs/promises";
import { createInterface } from "node:readline/promises";

const HORIZON = "https://horizon-testnet.stellar.org";

function waitForAuthStep(pollar, targetStep) {
  return new Promise((resolve, reject) => {
    const off = pollar.onAuthStateChange((state) => {
      console.log("[auth]", state.step);
      if (state.step === targetStep) {
        off();
        resolve(state);
      } else if (state.step === "error") {
        off();
        reject(new Error(`Pollar auth error: ${state.message} [${state.errorCode}]`));
      }
    });
  });
}

async function readCode() {
  const file = process.env.POLLAR_CODE_FILE;
  if (file) {
    console.log(`Waiting for the 6-digit code in ${file} ...`);
    const deadline = Date.now() + 5 * 60 * 1000;
    while (Date.now() < deadline) {
      try {
        const raw = (await readFile(file, "utf8")).trim();
        if (raw) {
          await unlink(file).catch(() => {});
          return raw;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 2000));
    }
    throw new Error("Timed out waiting for the code file.");
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const code = (await rl.question("6-digit code from your email: ")).trim();
  rl.close();
  return code;
}

async function giveTestnetXlm(address) {
  const funder = Keypair.random();
  const fb = await fetch(`https://friendbot.stellar.org?addr=${funder.publicKey()}`);
  if (!fb.ok) throw new Error(`friendbot HTTP ${fb.status}`);
  const server = new Horizon.Server(HORIZON);
  const account = await server.loadAccount(funder.publicKey());
  const exists = (await fetch(`${HORIZON}/accounts/${address}`)).status === 200;
  const op = exists
    ? Operation.payment({ destination: address, asset: Asset.native(), amount: "5" })
    : Operation.createAccount({ destination: address, startingBalance: "5" });
  const tx = new TransactionBuilder(account, { fee: BASE_FEE, networkPassphrase: Networks.TESTNET })
    .addOperation(op)
    .setTimeout(60)
    .build();
  tx.sign(funder);
  await server.submitTransaction(tx);
  console.log(`Wallet ${exists ? "topped up with" : "created on-chain with"} 5 testnet XLM.`);
  return funder.publicKey();
}

async function main() {
  const apiKey = process.env.POLLAR_PUBLISHABLE_KEY;
  const email = process.env.POLLAR_LOGIN_EMAIL;
  if (!apiKey?.startsWith("pub_testnet_") || !email) {
    console.error("Set POLLAR_PUBLISHABLE_KEY (pub_testnet_...) and POLLAR_LOGIN_EMAIL first.");
    process.exit(1);
  }

  const pollar = new PollarClient({ apiKey, stellarNetwork: "testnet", storage: createMemoryAdapter() });
  await pollar.ready();

  const enteringEmail = waitForAuthStep(pollar, "entering_email");
  pollar.beginEmailLogin();
  await enteringEmail;
  const enteringCode = waitForAuthStep(pollar, "entering_code");
  pollar.sendEmailCode(email);
  await enteringCode;
  const authenticated = waitForAuthStep(pollar, "authenticated");
  pollar.verifyEmailCode(await readCode());
  await authenticated;

  const signer = createPollarSigner(pollar, { network: "stellar:testnet" });
  console.log("Pollar wallet:", signer.address);

  const nirium = createNiriumAdapter({
    signer,
    network: "stellar:testnet",
    agentBaseUrl: "https://nirium-agent.fly.dev",
  });

  // Wrap the anchor call only to capture its result for this check.
  let resolveAnchor;
  let rejectAnchor;
  const anchored = new Promise((res, rej) => {
    resolveAnchor = res;
    rejectAnchor = rej;
  });
  const watched = {
    network: nirium.network,
    anchorAuditRecord: async (input) => {
      console.log("Anchoring:", JSON.stringify(input));
      const out = await nirium.anchorAuditRecord(input);
      resolveAnchor(out);
      return out;
    },
  };
  const stop = anchorOnTransactionSuccess(pollar, watched, {
    onError: (err, hash) => rejectAnchor(new Error(`anchor failed for ${hash}: ${err?.message ?? err}`)),
  });

  const funder = await giveTestnetXlm(signer.address);

  console.log("Sending 1 XLM through Pollar ...");
  const outcome = await pollar.sendPayment({
    destination: funder,
    amount: "1",
    asset: { type: "native" },
  });
  console.log("sendPayment outcome:", outcome.status, outcome.hash ?? "");

  const result = await Promise.race([
    anchored,
    new Promise((_, rej) => setTimeout(() => rej(new Error("No anchor within 60 s.")), 60000)),
  ]);
  stop();

  console.log("\n=== RESULT ===");
  console.log("tx hash:", outcome.hash);
  console.log("check it:", `${HORIZON}/transactions/${outcome.hash}`);
  console.log("anchor response:", JSON.stringify(result));
}

main().catch((e) => {
  console.error("FAILED:", e?.message ?? e);
  process.exit(1);
});
