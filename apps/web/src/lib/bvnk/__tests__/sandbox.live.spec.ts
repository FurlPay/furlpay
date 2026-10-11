import { describe, expect, it } from "vitest";
import { bvnkClient } from "../client";
import { bvnkApiConfig } from "../config";

// BVNK sandbox validation. SKIPPED unless BVNK_SANDBOX_LIVE=1 and sandbox
// credentials are set, so it never runs in CI or by accident, and it refuses
// to run against production. Read-only except the dry-run, which BVNK
// documents as a preview that moves nothing. It never creates a transfer,
// accepts a quote, creates a customer or wallet, or initiates a payout.
//
//   BVNK_SANDBOX_LIVE=1 BVNK_ENVIRONMENT=sandbox BVNK_HAWK_AUTH_ID=... BVNK_HAWK_AUTH_KEY=... \
//   [BVNK_SANDBOX_FROM_WALLET=... BVNK_SANDBOX_TO_WALLET=...] npx vitest run src/lib/bvnk/__tests__/sandbox.live.spec.ts
//
// A pass here is the first real evidence about BVNK's behaviour; until it has
// run, every other BVNK test is local and proves only conformance to the
// published definitions.
const live = process.env.BVNK_SANDBOX_LIVE === "1";

describe.skipIf(!live)("BVNK sandbox (live, read-only)", () => {
  it("is configured for the sandbox, never production", () => {
    expect(bvnkApiConfig().environment).toBe("sandbox");
    expect(bvnkApiConfig().baseUrl).toBe("https://api.sandbox.bvnk.com");
  });

  it("authenticates with Hawk and lists wallets in the documented shape", async () => {
    const page = await bvnkClient().listWallets({ pageSize: 5 });
    expect(Array.isArray(page.content)).toBe(true);
  });

  it("reads a wallet, including any fiat payment instruments", async () => {
    const page = await bvnkClient().listWallets({ pageSize: 1 });
    if (!page.content.length) return;
    const w = await bvnkClient().getWallet(page.content[0].id);
    expect(w.id).toBe(page.content[0].id);
  });

  it.skipIf(!process.env.BVNK_SANDBOX_FROM_WALLET || !process.env.BVNK_SANDBOX_TO_WALLET)("dry-runs a conversion (estimate only)", async () => {
    const t = await bvnkClient().transferDryRun({
      reference: `furlpay-sandbox-dryrun-${Date.now()}`,
      originator: { walletId: process.env.BVNK_SANDBOX_FROM_WALLET!, currency: "USD", amount: 1 },
      beneficiary: { walletId: process.env.BVNK_SANDBOX_TO_WALLET!, currency: "EUR" },
      conversion: { type: "QUOTE" },
    });
    expect(["PENDING_QUOTE_ACCEPTANCE", "PROCESSING"]).toContain(t.status);
  });

  it("refuses money movement while BVNK_MONEY_MOVEMENT_ENABLED is unset", async () => {
    expect(process.env.BVNK_MONEY_MOVEMENT_ENABLED).not.toBe("1");
    await expect(bvnkClient().refreshQuote("00000000-0000-4000-8000-000000000000")).rejects.toThrow(/disabled/);
  });
});
