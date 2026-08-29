// Side-effect-only module. Must be the FIRST import in spike.mjs.
//
// @pollar/core computes `isBrowser = typeof window !== "undefined" && typeof
// localStorage !== "undefined"` as a module-level `var`, evaluated once when
// the module is first loaded — not re-checked per call. ES module `import`
// declarations are hoisted and all execute before the rest of a file's body,
// regardless of where `globalThis.window = ...` is textually written in that
// same file — so setting the globals inline above a static
// `import { PollarClient } from "@pollar/core"` has no effect: the import
// already ran first. A separate module, imported before @pollar/core (static
// imports run in the order they're written relative to each other), is what
// actually gets the globals in place before @pollar/core's module body runs.
// Pollar's publishable keys are domain-restricted: their backend checks the
// request's Origin header against an allowlist and returns 403
// ORIGIN_NOT_ALLOWED otherwise (confirmed against the real API below, not
// assumed). A real browser attaches Origin automatically on every
// cross-origin fetch; Node's fetch does not, and there's no PollarClient
// config knob to set it — so the fix has to be a global fetch monkey-patch
// that adds it only for calls to Pollar's own API host.
const ORIGIN = process.env.POLLAR_ORIGIN || "https://nirium.xyz";
const realFetch = globalThis.fetch;
globalThis.fetch = (input, init = {}) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  if (url.includes(".pollar.xyz")) {
    const headers = new Headers(init.headers ?? (typeof input === "object" ? input.headers : undefined));
    headers.set("Origin", ORIGIN);
    init = { ...init, headers };
  }
  return realFetch(input, init);
};

globalThis.window = globalThis.window ?? {
  // Used for the visibilitychange-driven token-refresh scheduler. A no-op
  // is fine here — this script is a single short-lived run, not a long-lived
  // tab that needs to catch up on missed background refreshes.
  addEventListener: () => {},
  removeEventListener: () => {},
};
if (typeof globalThis.localStorage === "undefined") {
  const backing = new Map();
  globalThis.localStorage = {
    getItem: (k) => backing.get(k) ?? null,
    setItem: (k, v) => void backing.set(k, String(v)),
    removeItem: (k) => void backing.delete(k),
  };
}
