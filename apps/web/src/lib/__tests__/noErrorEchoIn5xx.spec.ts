import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// A 5xx is our failure, not the caller's input. Echoing the thrown message
// into it hands an unauthenticated caller whatever the provider, RPC or
// relayer said — account state, endpoint names, config hints. The 2026-10-02
// pass found six routes doing it (otp/start, stripe/intent, x402 policy
// evaluate/settle, compliance attestation x2, escrow). The detail belongs in
// the server log; the response carries a stable code.
//
// 4xx validation messages are deliberately NOT covered: those describe the
// caller's own request. Neither is the compliance guard's 503 readiness reply
// (`{ error: e.message, status: guardStatus() }`): it names a missing
// configuration piece next to public contract addresses, by design.

const API = join(__dirname, "..", "..", "app", "api");

function routes(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) {
      if (e !== "__tests__") routes(full, out);
    } else if (e === "route.ts") out.push(full);
  }
  return out;
}

const ECHO_5XX =
  /NextResponse\.json\(\s*\{[^}]*\berror:\s*\(?\s*(?:e|err|error)\s*(?:as\s+Error\s*)?\)?\s*(?:\?\.|\.)message[^}]*\}\s*,\s*\{\s*status:\s*5\d\d/;

describe("no route echoes a thrown error message in a 5xx", () => {
  it("every route.ts returns a code, not e.message, on 5xx", () => {
    const hits = routes(API)
      .filter((f) =>
        [...readFileSync(f, "utf8").matchAll(new RegExp(ECHO_5XX.source, "g"))].some((m) => !m[0].includes("guardStatus()"))
      )
      .map((f) => relative(API, f));
    expect(hits).toEqual([]);
  });

  it("the pattern catches the shape it targets", () => {
    expect(ECHO_5XX.test(`NextResponse.json({ error: (e as Error).message }, { status: 502 })`)).toBe(true);
    expect(ECHO_5XX.test(`NextResponse.json({ error: e.message || "x" }, { status: 502 })`)).toBe(true);
    expect(ECHO_5XX.test(`NextResponse.json({ error: (e as Error).message }, { status: 400 })`)).toBe(false);
  });
});
