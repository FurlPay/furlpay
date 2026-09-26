import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  abandonCeremonyChallenge,
  consumeCeremonyChallenge,
  putCeremonyChallenge,
} from "@/lib/webauthn";

// ---------------------------------------------------------------------------
// A late WebAuthn ceremony must not grant a step-up.
//
// THE DEFECT. The card reveal gate bounds the ceremony at 60s with Promise.race.
// Racing changes which promise the CALLER reads — it does nothing to the
// ceremony, which keeps running and still POSTs its assertion to
// /api/auth/passkey/authenticate. That route issues a session AND calls
// recordStepUp(), so a ceremony finishing after the bound silently established
// authorization the user had been told failed, satisfying the wallet-link
// (api/wallet/link/verify) and account (api/account) gates minutes later.
//
// Cancelling the browser prompt does not fix it either: a prompt already
// answered is already in flight, and WebAuthnAbortService is a singleton that
// would cancel unrelated ceremonies.
//
// THE FIX is server-side, because only the server can refuse a result. The
// challenge IS the server's record that a ceremony is live; deleting it makes
// verification fail at `expectedChallenge` — before the credential lookup,
// before signSession, and before recordStepUp.
//
// These tests exercise the real challenge store, not a model of it.
// ---------------------------------------------------------------------------

const CHALLENGE = "test-challenge-abcdefghijklmnop";

beforeEach(async () => {
  // Leave no state between cases; the store is shared in-memory here.
  await abandonCeremonyChallenge(CHALLENGE);
});

describe("the challenge store", () => {
  it("accepts an assertion for a live ceremony", async () => {
    await putCeremonyChallenge(CHALLENGE);
    expect(await consumeCeremonyChallenge(CHALLENGE)).toBe(true);
  });

  it("is single-use — a replay of the same challenge fails", async () => {
    await putCeremonyChallenge(CHALLENGE);
    expect(await consumeCeremonyChallenge(CHALLENGE)).toBe(true);
    expect(await consumeCeremonyChallenge(CHALLENGE)).toBe(false);
  });

  it("rejects a challenge that was never issued", async () => {
    expect(await consumeCeremonyChallenge("never-issued-challenge-xyz")).toBe(false);
  });
});

describe("abandonment blocks a late ceremony", () => {
  it("a ceremony abandoned before its assertion arrives CANNOT verify", async () => {
    // The exact sequence: options issued -> client gives up at 60s -> abandon ->
    // the assertion finally lands. It must not verify.
    await putCeremonyChallenge(CHALLENGE);
    await abandonCeremonyChallenge(CHALLENGE);

    expect(await consumeCeremonyChallenge(CHALLENGE)).toBe(false);
  });

  it("is idempotent — abandoning twice is safe", async () => {
    await putCeremonyChallenge(CHALLENGE);
    await abandonCeremonyChallenge(CHALLENGE);
    await expect(abandonCeremonyChallenge(CHALLENGE)).resolves.toBeUndefined();
    expect(await consumeCeremonyChallenge(CHALLENGE)).toBe(false);
  });

  it("abandoning a never-issued challenge is safe", async () => {
    await expect(abandonCeremonyChallenge("no-such-challenge-123")).resolves.toBeUndefined();
  });

  it("abandoning an ALREADY-CONSUMED ceremony does not disturb anything", async () => {
    // The race the client cannot avoid: abandon() may arrive after a legitimate
    // success. The session was rightly issued; this must be a no-op, not a
    // retroactive revocation the client has no authority to perform.
    await putCeremonyChallenge(CHALLENGE);
    expect(await consumeCeremonyChallenge(CHALLENGE)).toBe(true);
    await expect(abandonCeremonyChallenge(CHALLENGE)).resolves.toBeUndefined();
  });

  it("abandoning one ceremony leaves another alone", async () => {
    // Two tabs, two logins. Abandoning one must not break the other — which is
    // precisely why this is keyed by challenge and not a global cancel.
    const other = "other-live-challenge-qrstuvwx";
    await putCeremonyChallenge(CHALLENGE);
    await putCeremonyChallenge(other);

    await abandonCeremonyChallenge(CHALLENGE);

    expect(await consumeCeremonyChallenge(CHALLENGE)).toBe(false);
    expect(await consumeCeremonyChallenge(other)).toBe(true);
  });
});

describe("the server refuses before it grants anything", () => {
  const ROUTE = readFileSync(
    join(__dirname, "..", "..", "app", "api", "auth", "passkey", "authenticate", "route.ts"),
    "utf8"
  );

  it("verifies the challenge BEFORE signing a session or recording a step-up", () => {
    // Order is the whole security property. If recordStepUp ran first, deleting
    // the challenge would be decoration.
    const verify = ROUTE.indexOf("consumeCeremonyChallenge(challenge)");
    const session = ROUTE.indexOf("const token = await signSession");
    const stepUp = ROUTE.indexOf("recordStepUp(");

    expect(verify).toBeGreaterThan(-1);
    expect(session).toBeGreaterThan(verify);
    expect(stepUp).toBeGreaterThan(verify);
  });

  it("exposes DELETE for abandonment", () => {
    expect(ROUTE).toContain("export async function DELETE");
    expect(ROUTE).toContain("abandonCeremonyChallenge(body.challenge)");
  });

  it("validates the challenge shape rather than deleting an arbitrary key", () => {
    // The endpoint is unauthenticated by necessity (login has no session yet), so
    // the schema is the only thing bounding what it can address.
    expect(ROUTE).toContain("PasskeyAbandonSchema");
    const schema = readFileSync(join(__dirname, "..", "schemas", "webauthn.ts"), "utf8");
    expect(schema).toContain("PasskeyAbandonSchema");
    expect(schema).toMatch(/regex\(\/\^\[A-Za-z0-9_-\]\+\$\//);
  });

  it("rate-limits abandonment", () => {
    expect(ROUTE).toContain('"auth.passkey.authenticate.abandon"');
  });

  it("answers the same whether or not a challenge was there", () => {
    // Reporting it would turn this into a probe for live ceremonies.
    const del = ROUTE.slice(ROUTE.indexOf("export async function DELETE"));
    expect(del).toContain("abandoned: true");
    expect(del).not.toMatch(/status:\s*404/);
  });
});

describe("the client asks the server to refuse", () => {
  const PASSKEY = readFileSync(join(__dirname, "..", "passkey.ts"), "utf8");
  const PAGE = readFileSync(join(__dirname, "..", "..", "app", "cards", "page.tsx"), "utf8");
  const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("captures the challenge so it can be abandoned", () => {
    expect(code(PASSKEY)).toContain("challenge = optionsJSON.challenge");
  });

  it("DELETEs the challenge rather than only aborting the prompt", () => {
    // WebAuthnAbortService alone cannot help: a prompt already answered is
    // already in flight.
    const body = code(PASSKEY);
    expect(body).toMatch(/sendJSON\([\s\S]{0,80}"DELETE"\)/);
    expect(body).toContain("WebAuthnAbortService.cancelCeremony()");
  });

  it("does not abandon a ceremony that already succeeded", () => {
    expect(code(PASSKEY)).toContain("if (!challenge || settled) return;");
  });

  it("never lets abandonment throw into the caller", () => {
    // It runs on the failure path; a throw here would convert a clean refusal
    // into an error.
    const abandon = code(PASSKEY).slice(code(PASSKEY).indexOf("const abandon ="));
    expect(abandon).toMatch(/\.catch\(\(\) => \{/);
  });

  it("the card gate abandons on a false outcome", () => {
    const gate = code(PAGE).slice(
      code(PAGE).indexOf("const requestCardStepUp"),
      code(PAGE).indexOf("const loadTxs")
    );
    expect(gate).toContain("authenticateFingerprintBounded()");
    expect(gate).toContain("if (!outcome) void abandon();");
  });

  it("the card gate still clears its timer", () => {
    const gate = code(PAGE).slice(
      code(PAGE).indexOf("const requestCardStepUp"),
      code(PAGE).indexOf("const loadTxs")
    );
    expect(gate).toMatch(/finally \{[\s\S]{0,140}clearTimeout\(timer\)/);
  });

  it("does not await abandonment, so cleanup cannot delay the answer", () => {
    const gate = code(PAGE).slice(
      code(PAGE).indexOf("const requestCardStepUp"),
      code(PAGE).indexOf("const loadTxs")
    );
    expect(gate).toContain("void abandon()");
    expect(gate).not.toContain("await abandon()");
  });
});

describe("other callers keep working", () => {
  const PASSKEY = readFileSync(join(__dirname, "..", "passkey.ts"), "utf8");

  it("authenticateFingerprint still exists for login and swaps", () => {
    // Those flows have no timeout and nothing to abandon; changing their shape
    // would be unrelated churn.
    expect(PASSKEY).toContain("export async function authenticateFingerprint(): Promise<boolean>");
  });

  it("and delegates to the bounded version, so there is one ceremony path", () => {
    expect(PASSKEY).toMatch(/authenticateFingerprint\(\)[\s\S]{0,120}authenticateFingerprintBounded\(\)\.result/);
  });
});
