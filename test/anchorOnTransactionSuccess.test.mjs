import { test } from "node:test";
import assert from "node:assert/strict";
import { PollarClient, createMemoryAdapter } from "@pollar/core";
import { anchorOnTransactionSuccess } from "../dist/index.js";

const HASH = "a".repeat(64);
const HASH2 = "b".repeat(64);

// A tiny client that behaves like Pollar's: it replays the current state on subscribe.
function fakePollar(initial = null) {
  let state = initial;
  const listeners = new Set();
  return {
    onTransactionStateChange(cb) {
      listeners.add(cb);
      if (state) cb(state);
      return () => listeners.delete(cb);
    },
    emit(next) {
      state = next;
      for (const cb of listeners) cb(next);
    },
    count: () => listeners.size,
  };
}

function fakeAdapter(network = "stellar:testnet", impl) {
  const calls = [];
  return {
    network,
    calls,
    anchorAuditRecord: async (input) => {
      calls.push(input);
      if (impl) return impl(input);
      return { cid: "Qm" + calls.length };
    },
  };
}

const tick = () => new Promise((r) => setTimeout(r, 5));

test("the real PollarClient exposes onTransactionStateChange and starts with no state", () => {
  const client = new PollarClient({
    apiKey: "pub_testnet_00000000000000000000000000000000",
    storage: createMemoryAdapter(),
  });
  assert.equal(typeof client.onTransactionStateChange, "function");
  assert.equal(client.getTransactionState(), null);
  const off = anchorOnTransactionSuccess(client, fakeAdapter());
  assert.equal(typeof off, "function");
  off();
});

test("anchors chain, network, hash and observedAt on success, and nothing else", async () => {
  const pollar = fakePollar();
  const adapter = fakeAdapter();
  anchorOnTransactionSuccess(pollar, adapter, { now: () => Date.UTC(2026, 10, 1, 12, 0, 0) });
  pollar.emit({ step: "success", hash: HASH, sponsored: true, buildData: { appId: "secret-app" } });
  await tick();
  assert.equal(adapter.calls.length, 1);
  assert.deepEqual(adapter.calls[0], {
    record: { chain: "stellar", network: "testnet", hash: HASH, observedAt: "2026-11-01T12:00:00.000Z" },
    txHash: HASH,
    tag: "pollar-tx",
  });
  assert.equal(JSON.stringify(adapter.calls[0]).includes("secret-app"), false);
});

test("writes network mainnet for stellar:pubnet", async () => {
  const pollar = fakePollar();
  const adapter = fakeAdapter("stellar:pubnet");
  anchorOnTransactionSuccess(pollar, adapter);
  pollar.emit({ step: "success", hash: HASH });
  await tick();
  assert.equal(adapter.calls[0].record.network, "mainnet");
});

test("ignores every step that is not success, and success without a hash", async () => {
  const pollar = fakePollar();
  const adapter = fakeAdapter();
  anchorOnTransactionSuccess(pollar, adapter);
  for (const s of ["idle", "building", "signing", "submitted", "awaiting_cosign"]) {
    pollar.emit({ step: s, hash: HASH });
  }
  pollar.emit({ step: "error", phase: "submitting", hash: HASH });
  pollar.emit({ step: "success" });
  await tick();
  assert.equal(adapter.calls.length, 0);
});

test("deduplicates by hash, including the replay Pollar sends on subscribe", async () => {
  const pollar = fakePollar({ step: "success", hash: HASH });
  const adapter = fakeAdapter();
  anchorOnTransactionSuccess(pollar, adapter);
  await tick();
  assert.equal(adapter.calls.length, 1);
  pollar.emit({ step: "success", hash: HASH });
  pollar.emit({ step: "success", hash: HASH2 });
  await tick();
  assert.deepEqual(adapter.calls.map((c) => c.txHash), [HASH, HASH2]);
});

test("a failed anchor reaches onError, never throws into Pollar, and the hash can be retried", async () => {
  const pollar = fakePollar();
  let fail = true;
  const adapter = fakeAdapter("stellar:testnet", () => {
    if (fail) throw new Error("audit/log respondio HTTP 500");
    return { cid: "Qmok" };
  });
  const errors = [];
  anchorOnTransactionSuccess(pollar, adapter, { onError: (e, h) => errors.push([e.message, h]) });
  assert.doesNotThrow(() => pollar.emit({ step: "success", hash: HASH }));
  await tick();
  assert.deepEqual(errors, [["audit/log respondio HTTP 500", HASH]]);
  fail = false;
  pollar.emit({ step: "success", hash: HASH });
  await tick();
  assert.equal(adapter.calls.length, 2);
});

test("an onError that throws does not break the listener", async () => {
  const pollar = fakePollar();
  const adapter = fakeAdapter("stellar:testnet", () => {
    throw new Error("boom");
  });
  anchorOnTransactionSuccess(pollar, adapter, {
    onError: () => {
      throw new Error("bad handler");
    },
  });
  pollar.emit({ step: "success", hash: HASH });
  await tick();
  assert.equal(adapter.calls.length, 1);
});

test("the returned function stops listening", async () => {
  const pollar = fakePollar();
  const adapter = fakeAdapter();
  const off = anchorOnTransactionSuccess(pollar, adapter);
  assert.equal(pollar.count(), 1);
  off();
  assert.equal(pollar.count(), 0);
  pollar.emit({ step: "success", hash: HASH });
  await tick();
  assert.equal(adapter.calls.length, 0);
});

test("throws a clear error when the client has no onTransactionStateChange", () => {
  assert.throws(() => anchorOnTransactionSuccess({}, fakeAdapter()), /onTransactionStateChange/);
});
