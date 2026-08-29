// ───────────────────────────────────────────────────────────────────────────
// nirium-pollar-adapter
//
// Adapter de Nirium para el SDK de Pollar. Expone los nodos software-only de
// Nirium (x402 Settlement + Audit Trail) a una app que ya usa Pollar para el
// onboarding, sin que la app maneje llaves ni entienda x402.
//
//   import { PollarClient } from "@pollar/core";
//   import { createPollarSigner, createNiriumAdapter } from "nirium-pollar-adapter";
//
//   const pollar = new PollarClient({ apiKey });
//   const nirium = createNiriumAdapter({
//     signer:  createPollarSigner(pollar),
//     network: "stellar:pubnet",
//   });
//
//   // Un fetch normal. El 402, la firma y el reintento pasan por debajo.
//   const res  = await nirium.x402Fetch("https://nirium-agent-mainnet.fly.dev/api/v1/premium/signals");
//   const data = await res.json();
//
// POR QUÉ ASÍ: x402 v2 NO es "manda una transferencia y enseña el hash". El
// cliente firma un *auth entry* de Soroban (SEP-43), lo manda en el header
// X-PAYMENT, y el facilitador verifica y liquida — patrocinando los fees
// (`areFeesSponsored: true` en el 402 de Nirium). Por eso aquí no armamos
// transacciones a mano: delegamos en @x402/fetch, igual que el SDK oficial.
//
// ALCANCE (regla de mainnet): x402 y Audit Trail son software-only y
// non-custodial → viven en mainnet hoy. El vault/rebalance y las sesiones MPP
// sostienen fondos de terceros → siguen audit-gated. Ver NiriumMainnet.md.
// ───────────────────────────────────────────────────────────────────────────

import { x402Client as X402ClientClass, wrapFetchWithPayment } from "@x402/fetch";
import { ExactStellarScheme } from "@x402/stellar/exact/client";
import { Address, rpc, xdr } from "@stellar/stellar-sdk";
import type { SignAuthEntry, SignTransaction } from "@stellar/stellar-sdk/contract";

// ── Config ───────────────────────────────────────────────────────────────────

export type StellarNetwork = "stellar:testnet" | "stellar:pubnet";

/**
 * Signer SEP-43 que consume x402. `signTransaction` es opcional para clientes;
 * lo único indispensable es `signAuthEntry`. Sirve igual para cuentas G y C.
 */
export interface ClientStellarSigner {
  address: string;
  signAuthEntry: SignAuthEntry;
  signTransaction?: SignTransaction;
}

const DEFAULTS = {
  network: "stellar:testnet" as StellarNetwork,
  testnetAgent: "https://nirium-agent.fly.dev",
  pubnetAgent: "https://nirium-agent-mainnet.fly.dev",
  testnetRpc: "https://soroban-testnet.stellar.org",
  // El SDF no corre RPC público de mainnet: soroban.stellar.org NO existe.
  pubnetRpc: "https://soroban-rpc.mainnet.stellar.gateway.fm",
};

const isPubnet = (n: StellarNetwork) => n === "stellar:pubnet";

// ── Signer respaldado por Pollar ─────────────────────────────────────────────

/** Lo que devuelve `PollarClient.signAuthEntry` (@pollar/core ≥ 0.11). */
export type PollarSignAuthEntryOutcome =
  | { status: "signed"; signedAuthEntry: string }
  | { status: "error"; details?: string }
  | { signedAuthEntry: string; signerAddress?: string };

/**
 * Superficie mínima que necesitamos del cliente de Pollar. Se declara por
 * duck-typing a propósito: @pollar/core sigue moviéndose y no queremos atarnos
 * a una versión concreta.
 */
export interface PollarLikeClient {
  address?: string;
  walletAddress?: string;
  getAuthState?: () => any;
  /**
   * OJO: la firma de Pollar NO es la de SEP-43. Pide `validUntilLedger` (en vez
   * de networkPassphrase/address) y responde un outcome con `status`.
   */
  signAuthEntry?: (
    entryXdr: string,
    options: { validUntilLedger: number },
  ) => Promise<PollarSignAuthEntryOutcome>;
  signTransaction?: SignTransaction;
  signTx?: (unsignedXdr: string) => Promise<unknown>;
}

export interface PollarSignerOptions {
  /** Fuerza la dirección del pagador si el cliente aún no la expone. */
  address?: string;
  /** Red usada para leer el último ledger. Default: stellar:testnet. */
  network?: StellarNetwork;
  /** Soroban RPC para leer el último ledger. Default: el público de la red. */
  rpcUrl?: string;
  /**
   * Ledgers que la firma sigue siendo válida. Default 120 (~10 min a 5 s por
   * ledger) — con margen para la latencia del facilitador sin dejar una firma
   * viva de más.
   */
  validityLedgers?: number;
}

const MISSING_SIGN_AUTH_ENTRY =
  "El cliente de Pollar no expone signAuthEntry(). Está disponible desde " +
  "@pollar/core 0.11 — actualiza el paquete. Mientras tanto puedes pasar tu " +
  "propio signer a createNiriumAdapter({ signer }).";

// ── Los dos dialectos de "firmar un auth entry" ──────────────────────────────
//
// El mismo nombre, dos contratos incompatibles, y ninguno está mal:
//
//   stellar-sdk (`AssembledTransaction.signAuthEntries` → `authorizeEntry`)
//     manda el **HashIdPreimage** —lo que se va a hashear— y espera de vuelta
//     la **firma cruda** en base64. Él arma el entry final.
//
//   Pollar (`POST /tx/sign-auth-entry`)
//     espera el **SorobanAuthorizationEntry** completo y devuelve el **entry
//     ya firmado**, porque su backend valida el árbol de invocación contra el
//     allowlist antes de firmar — y para eso necesita ver el entry, no un hash.
//
// Sin traducir, su backend responde `SOROBAN_AUTH_ENTRY_INVALID: entryXdr is
// not a valid SorobanAuthorizationEntry` — que se lee como "el XDR viene roto"
// cuando en realidad viene bien, solo que es de otro tipo.
//
// El preimage trae nonce, expiración e invocación; lo único que le falta al
// entry es la dirección del firmante, que sí tenemos. Así que la reconstrucción
// es exacta: el hash que Pollar firma es idéntico al que el SDK espera.

/** ¿Este base64 es un HashIdPreimage de autorización Soroban? */
function asSorobanAuthPreimage(b64: string): xdr.HashIdPreimageSorobanAuthorization | null {
  try {
    const p = xdr.HashIdPreimage.fromXDR(b64, "base64");
    return p.switch().name === "envelopeTypeSorobanAuthorization"
      ? p.sorobanAuthorization()
      : null;
  } catch {
    return null;
  }
}

/** Rearma el entry sin firmar que el preimage describe. */
function entryFromPreimage(
  pre: xdr.HashIdPreimageSorobanAuthorization,
  signerAddress: string,
): xdr.SorobanAuthorizationEntry {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(signerAddress).toScAddress(),
        nonce: pre.nonce(),
        signatureExpirationLedger: pre.signatureExpirationLedger(),
        // Sin firmar: es justo lo que Pollar va a llenar.
        signature: xdr.ScVal.scvVoid(),
      }),
    ),
    rootInvocation: pre.invocation(),
  });
}

/**
 * Saca los 64 bytes de la firma ed25519 del entry que devolvió Pollar.
 * El campo `signature` es un ScVal y su forma depende de la cuenta: para una
 * cuenta clásica es un vec con un mapa `{ public_key, signature }`, pero se
 * aceptan también el mapa suelto y los bytes pelones para no romperse si
 * cambian la envoltura.
 */
function extractEd25519Signature(v: xdr.ScVal): Buffer {
  let node = v;
  if (node.switch().name === "scvVec") {
    const items = node.vec() ?? [];
    if (items.length !== 1) {
      throw new Error(
        `Pollar devolvió ${items.length} firmas en el auth entry; se esperaba 1.`,
      );
    }
    node = items[0];
  }
  if (node.switch().name === "scvMap") {
    for (const e of node.map() ?? []) {
      const key = e.key();
      if (key.switch().name === "scvSymbol" && key.sym().toString() === "signature") {
        return e.val().bytes();
      }
    }
    throw new Error("El auth entry firmado por Pollar no trae campo `signature`.");
  }
  if (node.switch().name === "scvBytes") return node.bytes();
  throw new Error(
    `Forma inesperada en la firma del auth entry de Pollar: ${node.switch().name}.`,
  );
}

/**
 * Envuelve un cliente de Pollar como signer SEP-43 para x402.
 *
 * Traduce entre los dos contratos: x402 pide SEP-43
 * (`signAuthEntry(xdr, { networkPassphrase, address }) → { signedAuthEntry }`),
 * y Pollar pide `signAuthEntry(xdr, { validUntilLedger }) → { status, … }`.
 * El `validUntilLedger` se calcula leyendo el último ledger de la red.
 */
export function createPollarSigner(
  pollar: PollarLikeClient,
  opts: PollarSignerOptions = {},
): ClientStellarSigner {
  const network = opts.network ?? DEFAULTS.network;
  const rpcUrl =
    opts.rpcUrl ?? (isPubnet(network) ? DEFAULTS.pubnetRpc : DEFAULTS.testnetRpc);
  const validityLedgers = opts.validityLedgers ?? 120;
  let rpcServer: rpc.Server | null = null;

  const resolveAddress = (): string => {
    const authState = pollar.getAuthState?.();
    const address =
      opts.address ??
      pollar.address ??
      pollar.walletAddress ??
      // @pollar/core ≥ 0.11: la wallet vive en la sesión autenticada.
      authState?.session?.wallet?.address ??
      authState?.walletAddress ??
      authState?.address;
    if (!address) {
      throw new Error(
        "No hay wallet conectada en Pollar. Llama a login() antes de pagar, o " +
          "pasa { address } a createPollarSigner().",
      );
    }
    return address;
  };

  const signAuthEntry: SignAuthEntry = async (payload) => {
    if (typeof pollar.signAuthEntry !== "function") {
      throw new Error(MISSING_SIGN_AUTH_ENTRY);
    }
    const signerAddress = resolveAddress();

    // El SDK de Stellar manda un preimage; un llamador directo puede mandar el
    // entry. Se distinguen decodificando, no adivinando por el contenido.
    const preimage = asSorobanAuthPreimage(payload);

    let entryXdr: string;
    let validUntilLedger: number;
    if (preimage) {
      entryXdr = entryFromPreimage(preimage, signerAddress).toXDR("base64");
      // La expiración la fijó el SDK y viaja DENTRO del hash que se firma:
      // pedirle a Pollar otra distinta produciría una firma que no valida.
      validUntilLedger = preimage.signatureExpirationLedger();
    } else {
      entryXdr = payload;
      rpcServer ??= new rpc.Server(rpcUrl);
      const { sequence } = await rpcServer.getLatestLedger();
      validUntilLedger = sequence + validityLedgers;
    }

    const outcome = await pollar.signAuthEntry(entryXdr, { validUntilLedger });

    if ("status" in outcome && outcome.status === "error") {
      throw new Error(
        `Pollar rechazó la firma del auth entry: ${outcome.details ?? "sin detalle"}`,
      );
    }
    const signedAuthEntry = (outcome as { signedAuthEntry?: string }).signedAuthEntry;
    if (!signedAuthEntry) {
      throw new Error("Pollar no devolvió signedAuthEntry.");
    }

    // Camino directo (nos dieron un entry): se devuelve tal cual.
    if (!preimage) return { signedAuthEntry, signerAddress };

    // Camino del SDK: hay que devolver la firma cruda, no el entry.
    const signed = xdr.SorobanAuthorizationEntry.fromXDR(signedAuthEntry, "base64");
    const creds = signed.credentials().address();
    const usedLedger = creds.signatureExpirationLedger();
    if (usedLedger !== validUntilLedger) {
      // Si su backend recortó la ventana, firmó otro hash y la firma no valida.
      // Vale más un error claro aquí que un `txBadAuth` diez pasos después.
      throw new Error(
        `Pollar firmó con expiración ${usedLedger} en vez de ${validUntilLedger}; `
        + "la firma no correspondería al pago. Sube el tope en Auth Policy → Signature validity.",
      );
    }
    return {
      signedAuthEntry: extractEd25519Signature(creds.signature()).toString("base64"),
      signerAddress,
    };
  };

  const signer: ClientStellarSigner = {
    get address() {
      return resolveAddress();
    },
    signAuthEntry,
  };

  // signTransaction es opcional para clientes x402; solo lo pasamos si existe.
  if (typeof pollar.signTransaction === "function") {
    signer.signTransaction = pollar.signTransaction.bind(pollar);
  }

  return signer;
}

/** ¿Este signer ya puede pagar? Útil para deshabilitar el botón en la UI. */
export function canSignX402(pollar: PollarLikeClient): boolean {
  return typeof pollar.signAuthEntry === "function";
}

// ── Adapter ──────────────────────────────────────────────────────────────────

export interface NiriumAdapterConfig {
  /** Signer SEP-43 — normalmente createPollarSigner(pollarClient). */
  signer: ClientStellarSigner;
  /** CAIP-2. Default: stellar:testnet. */
  network?: StellarNetwork;
  /** Base URL del agente. Default: el box de la red elegida. */
  agentBaseUrl?: string;
  /** Soroban RPC. Default: público de la red elegida. */
  rpcUrl?: string;
  /** fetch a envolver (para tests o runtimes sin fetch global). */
  fetchImpl?: typeof fetch;
}

export interface AuditAnchorInput {
  /** sha-256 hex (64 chars), con o sin prefijo "sha-256:". */
  hash?: string;
  /** JSON pequeño (≤8KB). No metas datos personales: IPFS no se borra. */
  record?: Record<string, unknown>;
  txHash?: string;
  tag?: string;
}

export function createNiriumAdapter(config: NiriumAdapterConfig) {
  const network = config.network ?? DEFAULTS.network;
  const agentBaseUrl = (
    config.agentBaseUrl ??
    (isPubnet(network) ? DEFAULTS.pubnetAgent : DEFAULTS.testnetAgent)
  ).replace(/\/$/, "");
  const rpcUrl =
    config.rpcUrl ?? (isPubnet(network) ? DEFAULTS.pubnetRpc : DEFAULTS.testnetRpc);
  const baseFetch = config.fetchImpl ?? fetch;

  // El cliente x402 negocia el 402, firma el auth entry y reintenta solo.
  const x402 = new (X402ClientClass as any)().register(
    "stellar:*",
    new (ExactStellarScheme as any)(config.signer, { url: rpcUrl }),
  );
  const paidFetch = wrapFetchWithPayment(baseFetch, x402) as typeof fetch;

  /**
   * fetch con pago automático. Si el recurso responde 402, se paga y se
   * reintenta; si responde 200, pasa directo. Los fees los patrocina el
   * facilitador — la wallet del usuario no necesita XLM para el gas.
   */
  async function x402Fetch(url: string, init?: RequestInit): Promise<Response> {
    try {
      return await paidFetch(url, init);
    } catch (e) {
      // En el navegador un bloqueo de CSP, uno de CORS y un servicio caído dan
      // el MISMO "Failed to fetch" sin decir a quién no se pudo llegar — y esa
      // es justo la única pista que los distingue. Nombrar el host convierte
      // media tarde de adivinanzas en una línea de configuración.
      const msg = e instanceof Error ? e.message : String(e);
      if (/failed to fetch|networkerror|load failed/i.test(msg)) {
        throw new Error(
          `${msg} — el navegador no pudo alcanzar ${url}. Revisa connect-src del CSP, `
          + "y que el servidor exponga PAYMENT-REQUIRED y acepte PAYMENT-SIGNATURE "
          + "y Access-Control-Expose-Headers en su CORS.",
        );
      }
      throw e;
    }
  }

  /**
   * Atajo tipado a los endpoints premium del agente.
   *
   * TESTNET ONLY: las señales las produce el loop autónomo, que no corre en
   * el box de mainnet — ahí un guard de capacidad responde 501 ANTES del
   * cobro (agregado el 6-ago-2026, ver `capabilityGuard` en el agente), así
   * que no se cobra, pero tampoco hay señales. Para verificar el pago en
   * mainnet usa getPremiumMarket().
   */
  async function getPremiumSignals(): Promise<unknown> {
    const res = await x402Fetch(`${agentBaseUrl}/api/v1/premium/signals`);
    if (!res.ok) throw new Error(`premium/signals respondió HTTP ${res.status}`);
    return res.json();
  }

  /**
   * Atajo tipado al estado de mercado premium. A diferencia de
   * getPremiumSignals(), no depende del loop autónomo — funciona y cobra
   * igual en testnet y en mainnet.
   */
  async function getPremiumMarket(): Promise<unknown> {
    const res = await x402Fetch(`${agentBaseUrl}/api/v1/premium/market`);
    if (!res.ok) throw new Error(`premium/market respondió HTTP ${res.status}`);
    return res.json();
  }

  /**
   * Ancla evidencia en IPFS (Audit Trail Node). Software-only: no firma, no
   * mueve fondos, funciona en mainnet hoy. Se anclan HASHES, no PII.
   */
  async function anchorAuditRecord(input: AuditAnchorInput): Promise<{ cid: string } & Record<string, unknown>> {
    const res = await baseFetch(`${agentBaseUrl}/api/audit/log`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...input,
        network: isPubnet(network) ? "mainnet" : "testnet",
      }),
    });
    if (!res.ok) {
      throw new Error(`audit/log respondió HTTP ${res.status}: ${await res.text()}`);
    }
    return res.json() as Promise<{ cid: string } & Record<string, unknown>>;
  }

  /**
   * Tasa CETES de referencia (lectura pública, sin key ni pago).
   * Sale de /api/tickers, que la publica en ambos boxes — /api/loop/status no
   * sirve en mainnet porque ahí el loop autónomo está apagado.
   */
  async function getCetesRate(): Promise<number | null> {
    try {
      const res = await baseFetch(`${agentBaseUrl}/api/tickers`, { cache: "no-store" });
      const data: any = await res.json();
      const rate = data?.market?.cetesRate;
      return typeof rate === "number" ? rate : null;
    } catch {
      return null;
    }
  }

  return {
    network,
    agentBaseUrl,
    address: config.signer.address,
    // Settlement (x402) — mainnet
    x402Fetch,
    getPremiumSignals,
    getPremiumMarket,
    // Audit Trail — mainnet
    anchorAuditRecord,
    // Lecturas públicas
    getCetesRate,
  };
}

export type NiriumAdapter = ReturnType<typeof createNiriumAdapter>;
