import { test } from "node:test";
import assert from "node:assert/strict";
import { xdr, Address } from "@stellar/stellar-sdk";
import { createPollarSigner, canSignX402 } from "../dist/index.js";

const SIGNER_ADDRESS = "GBI5YGW6LVLH5QARPQJ24SEISBRU7QT2ROZNNYB35NID6SWDRQCHKUDH";
const USDC_TESTNET = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

// Builds a real Soroban auth preimage the way @x402/fetch / stellar-sdk's
// contract client would hand it to a signer -- same shape signAuthEntry()
// has to recognize via asSorobanAuthPreimage() before it can take the
// preimage branch (no RPC call) instead of the direct-entry branch.
function buildPreimage({ nonce = "12345", signatureExpirationLedger = 1000 } = {}) {
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(USDC_TESTNET).toScAddress(),
        functionName: "transfer",
        args: [],
      }),
    ),
    subInvocations: [],
  });
  const preimageObj = new xdr.HashIdPreimageSorobanAuthorization({
    networkId: Buffer.alloc(32, 7),
    nonce: xdr.Int64.fromString(nonce),
    signatureExpirationLedger,
    invocation,
  });
  return {
    xdr: xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(preimageObj).toXDR("base64"),
    invocation,
    nonce,
  };
}

// Builds the entry Pollar's signAuthEntry() would hand back: same
// nonce/invocation as the preimage, a signature, and (by default) the same
// expiration -- the field entryFromPreimage() re-derives from the preimage
// and that createPollarSigner() checks Pollar didn't silently change.
function buildSignedEntry({ invocation, nonce, signatureExpirationLedger }) {
  const entry = new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(SIGNER_ADDRESS).toScAddress(),
        nonce: xdr.Int64.fromString(nonce),
        signatureExpirationLedger,
        signature: xdr.ScVal.scvBytes(Buffer.alloc(64, 9)),
      }),
    ),
    rootInvocation: invocation,
  });
  return entry.toXDR("base64");
}

test("canSignX402 reflects whether the client exposes signAuthEntry", () => {
  assert.equal(canSignX402({ signAuthEntry: async () => {} }), true);
  assert.equal(canSignX402({}), false);
});

test("signer.address resolves opts.address first, ignoring the client entirely", () => {
  const signer = createPollarSigner(
    { address: "GOTHER...SHOULD_NOT_WIN" },
    { address: SIGNER_ADDRESS },
  );
  assert.equal(signer.address, SIGNER_ADDRESS);
});

test("signer.address falls back through pollar.address, walletAddress, then the three auth-state shapes", () => {
  assert.equal(
    createPollarSigner({ address: SIGNER_ADDRESS }).address,
    SIGNER_ADDRESS,
    "pollar.address",
  );
  assert.equal(
    createPollarSigner({ walletAddress: SIGNER_ADDRESS }).address,
    SIGNER_ADDRESS,
    "pollar.walletAddress",
  );
  assert.equal(
    createPollarSigner({
      getAuthState: () => ({ session: { wallet: { address: SIGNER_ADDRESS } } }),
    }).address,
    SIGNER_ADDRESS,
    "authState.session.wallet.address (@pollar/core >= 0.11)",
  );
  assert.equal(
    createPollarSigner({ getAuthState: () => ({ walletAddress: SIGNER_ADDRESS }) }).address,
    SIGNER_ADDRESS,
    "authState.walletAddress",
  );
  assert.equal(
    createPollarSigner({ getAuthState: () => ({ address: SIGNER_ADDRESS }) }).address,
    SIGNER_ADDRESS,
    "authState.address",
  );
});

test("signer.address throws a clear error when no wallet is connected anywhere", () => {
  assert.throws(
    () => createPollarSigner({}).address,
    /No hay wallet conectada en Pollar/,
  );
});

test("signAuthEntry throws MISSING_SIGN_AUTH_ENTRY when the client predates @pollar/core 0.11", async () => {
  const signer = createPollarSigner({ address: SIGNER_ADDRESS });
  await assert.rejects(
    () => signer.signAuthEntry("anything", {}),
    /no expone signAuthEntry\(\)/,
  );
});

test("signAuthEntry (preimage path): sends Pollar the preimage's own expiration, not a freshly computed one, and returns the raw signature", async () => {
  const { xdr: preimageXdr, invocation, nonce } = buildPreimage({ signatureExpirationLedger: 4242 });
  let seenXdr, seenOpts;
  const pollar = {
    address: SIGNER_ADDRESS,
    signAuthEntry: async (entryXdr, opts) => {
      seenXdr = entryXdr;
      seenOpts = opts;
      return {
        signedAuthEntry: buildSignedEntry({
          invocation,
          nonce,
          signatureExpirationLedger: opts.validUntilLedger,
        }),
      };
    },
  };
  const signer = createPollarSigner(pollar);
  const result = await signer.signAuthEntry(preimageXdr, {});

  // No RPC round trip on this path: the expiration comes straight out of
  // the preimage the caller already signed a hash over, not a fresh
  // getLatestLedger() call -- asking Pollar for a different one would
  // produce a signature over a different hash entirely.
  assert.equal(seenOpts.validUntilLedger, 4242);
  assert.ok(typeof seenXdr === "string" && seenXdr.length > 0);
  assert.equal(result.signerAddress, SIGNER_ADDRESS);
  // Direct bytes, not still wrapped in the entry Pollar returned -- the
  // whole point of extractEd25519Signature().
  assert.equal(result.signedAuthEntry, Buffer.alloc(64, 9).toString("base64"));
});

test("signAuthEntry (preimage path): rejects when Pollar signs with a different expiration than requested", async () => {
  const { xdr: preimageXdr, invocation, nonce } = buildPreimage({ signatureExpirationLedger: 4242 });
  const pollar = {
    address: SIGNER_ADDRESS,
    signAuthEntry: async () => ({
      // Pollar's backend silently capped the window -- this is exactly the
      // "signed a different hash than the one that matters" failure mode
      // the comment in the source calls out, not a hypothetical.
      signedAuthEntry: buildSignedEntry({ invocation, nonce, signatureExpirationLedger: 1000 }),
    }),
  };
  const signer = createPollarSigner(pollar);
  await assert.rejects(
    () => signer.signAuthEntry(preimageXdr, {}),
    /firmó con expiración 1000 en vez de 4242/,
  );
});

test("signAuthEntry propagates Pollar's own error status instead of a generic failure", async () => {
  const { xdr: preimageXdr } = buildPreimage();
  const pollar = {
    address: SIGNER_ADDRESS,
    signAuthEntry: async () => ({ status: "error", details: "usuario canceló la firma" }),
  };
  const signer = createPollarSigner(pollar);
  await assert.rejects(
    () => signer.signAuthEntry(preimageXdr, {}),
    /Pollar rechazó la firma.*usuario canceló la firma/,
  );
});

test("signAuthEntry rejects when Pollar's response has no signedAuthEntry at all", async () => {
  const { xdr: preimageXdr } = buildPreimage();
  const pollar = {
    address: SIGNER_ADDRESS,
    signAuthEntry: async () => ({ status: "ok" }),
  };
  const signer = createPollarSigner(pollar);
  await assert.rejects(
    () => signer.signAuthEntry(preimageXdr, {}),
    /no devolvió signedAuthEntry/,
  );
});

test("signTransaction is only attached to the signer when the underlying client provides it", () => {
  const withSignTx = createPollarSigner({
    address: SIGNER_ADDRESS,
    signTransaction: async () => ({}),
  });
  assert.equal(typeof withSignTx.signTransaction, "function");

  const withoutSignTx = createPollarSigner({ address: SIGNER_ADDRESS });
  assert.equal(withoutSignTx.signTransaction, undefined);
});
