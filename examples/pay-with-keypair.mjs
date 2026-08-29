// ───────────────────────────────────────────────────────────────────────────
// Ejemplo: pagar un endpoint x402 de Nirium con una llave Stellar cualquiera.
//
// Sirve para verificar el adapter END-TO-END sin depender de Pollar: el signer
// es enchufable, así que aquí usamos un signer ed25519 estándar. El día que
// Pollar exponga signAuthEntry, se cambia UNA línea:
//
//   -  const signer = createEd25519Signer(secret, network);
//   +  const signer = createPollarSigner(pollarClient);
//
// Uso:
//   NIRIUM_DEMO_SECRET=S... node examples/pay-with-keypair.mjs
//   NIRIUM_DEMO_SECRET=S... NIRIUM_NETWORK=stellar:testnet node examples/pay-with-keypair.mjs
//
// OJO: contra stellar:pubnet esto gasta USDC REAL (0.05 por llamada a market).
//
// Usa getPremiumMarket(), no getPremiumSignals(): desde el 6-ago-2026 el box
// de mainnet responde 501 a /premium/signals ANTES de cobrar (no hay loop
// autónomo ahí que produzca señales) — con signals este ejemplo fallaría en
// el paso 1/2 usando su propio default de red.
// ───────────────────────────────────────────────────────────────────────────

import { createEd25519Signer } from "@x402/stellar";
import { createNiriumAdapter } from "../dist/index.js";

const secret = process.env.NIRIUM_DEMO_SECRET;
if (!secret) {
  console.error("Falta NIRIUM_DEMO_SECRET (llave secreta Stellar S...).");
  process.exit(1);
}

const network = process.env.NIRIUM_NETWORK ?? "stellar:pubnet";
const signer = createEd25519Signer(secret, network);
const nirium = createNiriumAdapter({ signer, network });

console.log(`red     : ${network}`);
console.log(`pagador : ${signer.address}`);
console.log(`agente  : ${nirium.agentBaseUrl}`);

// 1) x402 — el 402, la firma del auth entry y el reintento pasan por debajo.
console.log("\n[1/2] pagando /api/v1/premium/market (0.05 USDC)…");
const market = await nirium.getPremiumMarket();
console.log("      OK — respuesta:", JSON.stringify(market).slice(0, 220));

// 2) Audit Trail — software-only, sin firma ni pago.
console.log("\n[2/2] anclando evidencia en IPFS…");
const anchor = await nirium.anchorAuditRecord({
  record: { source: "pollar-adapter-example", paidResource: "premium/market", at: new Date().toISOString() },
  tag: "adapter-e2e",
});
console.log("      OK — CID:", anchor.cid ?? JSON.stringify(anchor).slice(0, 200));

const rate = await nirium.getCetesRate();
console.log("\ntasa CETES de referencia:", rate ?? "n/d");
