// Compile-time check against the real @pollar/core. If a Pollar release changes
// the shape createPollarSigner depends on, this file stops compiling and CI
// fails here, not in a user's app. Never executed and not part of dist/.
import type { PollarClient, AuthState } from "@pollar/core";
import type { PollarLikeClient } from "../src/index.js";

type Needed = Required<Pick<PollarLikeClient, "signAuthEntry" | "getAuthState">>;

// 1. The two members the signer calls exist on the real class, with compatible types.
export const realClientHasWhatWeNeed = (client: PollarClient): Needed => client;

// 2. The authenticated session still carries wallet.address, where resolveAddress() reads it.
export type SessionWalletAddress = Extract<AuthState, { step: "authenticated" }>["session"]["wallet"]["address"];

// 3. Negative control: a client without signAuthEntry must NOT satisfy check 1.
// If this line ever stops being an error, check 1 has become meaningless.
declare const withoutSignAuthEntry: { getAuthState(): unknown };
// @ts-expect-error missing signAuthEntry
export const mustFail: Needed = withoutSignAuthEntry;
