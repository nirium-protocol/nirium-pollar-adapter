import { test } from "node:test";
import assert from "node:assert/strict";
import { activateWallet, PollarActivationError } from "../dist/index.js";

const GOOD_KEY = "GBI5YGW6LVLH5QARPQJ24SEISBRU7QT2ROZNNYB35NID6SWDRQCHKUDH";

function mockFetch(status, body) {
  return async (_url, _init) => ({
    status,
    json: async () => body,
  });
}

test("activateWallet rejects a malformed publicKey before calling fetch", async () => {
  let fetchCalled = false;
  const fetchImpl = async () => {
    fetchCalled = true;
    return { status: 200, json: async () => ({}) };
  };
  await assert.rejects(
    () => activateWallet("not-a-real-address", { secretKey: "sec_testnet_x", fetchImpl }),
    /no es una dirección Stellar G/,
  );
  assert.equal(fetchCalled, false);
});

test("activateWallet returns activated:true with the funded amount on 200", async () => {
  const fetchImpl = mockFetch(200, {
    content: { publicKey: GOOD_KEY, amount: "1.5" },
    code: "SERVER_WALLET_ACTIVATED",
    success: true,
  });
  const result = await activateWallet(GOOD_KEY, { secretKey: "sec_testnet_x", fetchImpl });
  assert.deepEqual(result, { activated: true, amount: "1.5" });
});

test("activateWallet treats 409 (already funded) as a non-throwing success, per Pollar's own docs", async () => {
  const fetchImpl = mockFetch(409, { code: "WALLET_ALREADY_FUNDED", success: false });
  const result = await activateWallet(GOOD_KEY, { secretKey: "sec_testnet_x", fetchImpl });
  assert.deepEqual(result, { activated: false });
});

test("activateWallet throws PollarActivationError with the real code/status for anything else", async () => {
  const fetchImpl = mockFetch(404, { code: "WALLET_NOT_FOUND", success: false });
  await assert.rejects(
    () => activateWallet(GOOD_KEY, { secretKey: "sec_testnet_x", fetchImpl }),
    (err) => {
      assert.ok(err instanceof PollarActivationError);
      assert.equal(err.code, "WALLET_NOT_FOUND");
      assert.equal(err.status, 404);
      return true;
    },
  );
});

test("activateWallet sends the secret key in x-pollar-api-key, not Authorization", async () => {
  let seenHeaders;
  const fetchImpl = async (_url, init) => {
    seenHeaders = init.headers;
    return { status: 200, json: async () => ({ content: { amount: "1.0" }, success: true }) };
  };
  await activateWallet(GOOD_KEY, { secretKey: "sec_testnet_abc123", fetchImpl });
  assert.equal(seenHeaders["x-pollar-api-key"], "sec_testnet_abc123");
  assert.equal(seenHeaders["Authorization"], undefined);
});
