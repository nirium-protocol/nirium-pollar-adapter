import { test } from "node:test";
import assert from "node:assert/strict";
import { xdr, Address } from "@stellar/stellar-sdk";
import { PollarClient, createMemoryAdapter, POLLAR_CORE_VERSION } from "@pollar/core";
import { createPollarSigner, canSignX402 } from "../dist/index.js";

// Runs against the real @pollar/core pinned in devDependencies, not a mock of
// its shape. The peer range in package.json promises ^0.11.4.

const SIGNER_ADDRESS = "GBI5YGW6LVLH5QARPQJ24SEISBRU7QT2ROZNNYB35NID6SWDRQCHKUDH";
const USDC_TESTNET = "CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA";

function realClient() {
  return new PollarClient({
    apiKey: "pub_testnet_00000000000000000000000000000000",
    storage: createMemoryAdapter(),
  });
}

function preimage(signatureExpirationLedger) {
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
  const obj = new xdr.HashIdPreimageSorobanAuthorization({
    networkId: Buffer.alloc(32, 7),
    nonce: xdr.Int64.fromString("12345"),
    signatureExpirationLedger,
    invocation,
  });
  return { xdr: xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(obj).toXDR("base64"), invocation };
}

function signedEntry(invocation, signatureExpirationLedger) {
  return new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsAddress(
      new xdr.SorobanAddressCredentials({
        address: Address.fromString(SIGNER_ADDRESS).toScAddress(),
        nonce: xdr.Int64.fromString("12345"),
        signatureExpirationLedger,
        signature: xdr.ScVal.scvBytes(Buffer.alloc(64, 9)),
      }),
    ),
    rootInvocation: invocation,
  }).toXDR("base64");
}

test("the installed @pollar/core is inside the range the peer dependency promises", () => {
  const [major, minor, patch] = POLLAR_CORE_VERSION.split(/[.-]/).map(Number);
  assert.equal(major, 0);
  assert.equal(minor, 11);
  assert.ok(patch >= 4, `got ${POLLAR_CORE_VERSION}`);
});

test("the real PollarClient exposes signAuthEntry and getAuthState, so canSignX402 is true", () => {
  const client = realClient();
  assert.equal(typeof client.signAuthEntry, "function");
  assert.equal(typeof client.getAuthState, "function");
  assert.equal(canSignX402(client), true);
});

test("a logged-out real client gives createPollarSigner a clear error, not a crash", () => {
  const client = realClient();
  assert.equal(client.getAuthState().step, "idle");
  assert.throws(() => createPollarSigner(client).address, /No hay wallet conectada en Pollar/);
});

test("createPollarSigner drives a real PollarClient instance: reads the session wallet and calls signAuthEntry(xdr, { validUntilLedger })", async () => {
  const client = realClient();
  const { xdr: pre, invocation } = preimage(4242);
  let seen;
  client.getAuthState = () => ({ step: "authenticated", session: { wallet: { address: SIGNER_ADDRESS } } });
  client.signAuthEntry = async (entryXdr, opts) => {
    seen = { entryXdr, opts };
    return { status: "signed", signedAuthEntry: signedEntry(invocation, opts.validUntilLedger) };
  };
  const signer = createPollarSigner(client);
  assert.equal(signer.address, SIGNER_ADDRESS);
  const out = await signer.signAuthEntry(pre, {});
  // Pollar's signAuthEntry takes an unsigned SorobanAuthorizationEntry, so the
  // signer converts the x402 preimage into one before calling it.
  const entry = xdr.SorobanAuthorizationEntry.fromXDR(seen.entryXdr, "base64");
  const creds = entry.credentials().address();
  assert.equal(creds.nonce().toString(), "12345");
  assert.equal(creds.signatureExpirationLedger(), 4242);
  assert.equal(seen.opts.validUntilLedger, 4242);
  assert.ok(out, "the signer returns something for x402 to use");
});
