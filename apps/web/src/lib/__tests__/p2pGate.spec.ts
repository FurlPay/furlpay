// ---------------------------------------------------------------------------
// P2P is closed in production — every handler, not only the escrow-moving ones.
//
// Before: only orders POST, release and cancel were gated. Ads, saved payment
// methods (bank account numbers, UPI handles), quotes, appeals and ratings ran
// in production against process memory. P2P_LIVE (lib/flags.ts) is
// `unimplemented` until the state is durable and row-locked.
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { signSession } from "@/lib/session";
import { findOrCreateUserByIdentity } from "@/lib/store";
import { flagState } from "@/lib/flags";
import { POST as adsPOST, GET as adsGET } from "@/app/api/p2p/ads/route";
import { POST as methodsPOST } from "@/app/api/p2p/payment-methods/route";

const P2P = path.resolve(__dirname, "..", "..", "app", "api", "p2p");

function routes(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" ? [] : routes(f);
    return e.name === "route.ts" ? [f] : [];
  });
}

describe("every P2P handler starts at the gate", () => {
  it("has no handler whose first statement is not the P2P gate", () => {
    const ungated: string[] = [];
    for (const f of routes(P2P)) {
      const lines = fs.readFileSync(f, "utf8").split(/\r?\n/);
      lines.forEach((line, i) => {
        if (!/^export (async )?function (GET|POST|PUT|PATCH|DELETE)\b/.test(line)) return;
        const first = lines.slice(i + 1).find((l) => l.trim() !== "" && !l.trim().startsWith("//")) ?? "";
        if (!/p2p(Settlement)?Unavailable\(\)/.test(first)) ungated.push(`${path.relative(P2P, f)}:${i + 1}`);
      });
    }
    expect(ungated).toEqual([]);
  });
});

describe("P2P in production", () => {
  afterEach(() => vi.unstubAllEnvs());

  async function actor() {
    const { account } = findOrCreateUserByIdentity({ email: `p2pgate-${randomUUID()}@furlpay.test`, name: "Gate" });
    return signSession({ sub: account.user.id, safe: "0x0", roles: ["user"], jti: randomUUID() });
  }
  const req = (p: string, token: string, method: "GET" | "POST", body?: unknown) =>
    new NextRequest(`https://furlpay.com/api${p}`, {
      method,
      headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-forwarded-for": "10.8.0.1" },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  it("refuses to store bank details or post ads, and lists nothing", async () => {
    vi.stubEnv("FURLPAY_ENV", "production");
    const token = await actor();
    const saved = await methodsPOST(
      req("/p2p/payment-methods", token, "POST", { type: "upi", label: "x", holderName: "x", account: "x@okbank" })
    );
    expect(saved.status).toBe(503);
    expect((await saved.json()).capability).toBe("P2P_LIVE");
    expect((await adsPOST(req("/p2p/ads", token, "POST", { side: "sell" }))).status).toBe(503);
    expect((await adsGET(req("/p2p/ads", token, "GET"))).status).toBe(503);
  });

  it("stays closed on preview builds (NODE_ENV=production) even when classified development", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("FURLPAY_ENV", "development");
    const token = await actor().catch(() => "");
    expect((await adsGET(req("/p2p/ads", token, "GET"))).status).toBe(503);
  });

  it("P2P_LIVE cannot be switched on by configuration", () => {
    vi.stubEnv("FURLPAY_ENV", "production");
    vi.stubEnv("P2P_LIVE", "true");
    vi.stubEnv("FURLPAY_P2P_STORE", "x");
    expect(flagState("P2P_LIVE").blocker?.reason).toBe("unimplemented");
  });
});
