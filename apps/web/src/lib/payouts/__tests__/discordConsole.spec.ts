import { describe, it, expect, beforeEach } from "vitest";
import { handlePaymentsConsole } from "../discord/handler";
import { completeStep, completeWalletStep, issueStepToken } from "../discord/onboarding";
import { formatAtomic, homeScreen, parseId, id, walletConfirmScreen } from "../discord/console";

/** Complete every verification step for a user, so tests that are about
 *  something else are not blocked by the DM gate. */
async function verify(discordUserId: string) {
  for (const step of ["captcha", "email", "phone"] as const) {
    const t = await issueStepToken(discordUserId, step);
    await completeStep({ tokenId: t.id, discordUserId, answer: t.secret });
  }
  await completeWalletStep(discordUserId, "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
}

// ---------------------------------------------------------------------------
// The Discord payments console.
//
// Two properties dominate:
//
//   1. EVERY reply is ephemeral. #payments-payouts is a public channel; a
//      balance or a destination address posted into it is visible to everyone.
//      Flags 64 is a security control here, not a preference.
//
//   2. custom_id and select values are UNTRUSTED. They round-trip through the
//      client and can be edited with a proxy, so a forged rail must be refused
//      by the handler rather than by the menu that offered it.
// ---------------------------------------------------------------------------

const EPHEMERAL = 1 << 6;

beforeEach(async () => {
  process.env.DISCORD_GUILD_ID = "1522006337070825482";
  const g = globalThis as unknown as { __furlpayKv?: Map<string, unknown> };
  g.__furlpayKv?.clear();
  // These tests are about routing and privacy, not onboarding, so the
  // member is verified up front — the DM gate is covered in its own spec.
  await verify("user-123");
});

const interaction = (over: Record<string, unknown> = {}) => ({
  type: 3,
  guild_id: "1522006337070825482",
  member: { user: { id: "user-123", username: "mod" } },
  ...over,
});

const press = (customId: string, extra: Record<string, unknown> = {}) =>
  handlePaymentsConsole(interaction({ data: { custom_id: customId, ...extra } }) as never);

describe("ownership of interactions", () => {
  it("returns null for a custom_id belonging to another feature", async () => {
    // The chain convention: not ours means null, so the next handler runs. A
    // handler that claims everything silently breaks role pickers and captcha.
    for (const foreign of ["verify:start", "role:pick:dev", "", "fp:other:x"]) {
      expect(await press(foreign)).toBeNull();
    }
  });

  it("claims its own namespace", async () => {
    expect(await press(id("home"))).not.toBeNull();
  });

  it("answers the /payments command", async () => {
    const r = await handlePaymentsConsole(
      interaction({ type: 2, data: { name: "payments" } }) as never
    );
    expect(r).not.toBeNull();
  });
});

describe("everything is ephemeral", () => {
  it("sets flags 64 on every screen the console can reach", async () => {
    const screens = [
      "home",
      "account",
      "wallet_asset",
      "wallet_rail",
      "security",
      "freeze_confirm",
      "support",
      "earnings",
      "payout",
      "crypto",
    ];
    for (const s of screens) {
      const r = await press(id(s as never, "USDC"));
      expect(r, s).not.toBeNull();
      // THE LOAD-BEARING ASSERTION. A missing flag here posts a balance into a
      // public channel.
      expect((r!.data as { flags?: number }).flags, s).toBe(EPHEMERAL);
    }
  });

  it("keeps the command response private too", async () => {
    const r = await handlePaymentsConsole(
      interaction({ type: 2, data: { name: "payments" } }) as never
    );
    expect((r!.data as { flags?: number }).flags).toBe(EPHEMERAL);
  });
});

describe("untrusted input", () => {
  it("refuses a forged rail from a select menu", async () => {
    // The menu only offers available rails — but the value comes back from the
    // client, so the handler re-checks rather than trusting the menu.
    const r = await handlePaymentsConsole(
      interaction({
        data: { custom_id: id("wallet_address", "USDC"), values: ["TREASURY_DRAIN|base"] },
      }) as never
    );
    const body = JSON.stringify(r);
    expect(body).toMatch(/not available/i);
    expect(body).not.toMatch(/modal/i);
  });

  it("refuses a rail that exists but is not implemented", async () => {
    const r = await handlePaymentsConsole(
      interaction({
        data: { custom_id: id("wallet_address", "BTC"), values: ["BITCOIN_LIGHTNING|bitcoin:mainnet"] },
      }) as never
    );
    expect(JSON.stringify(r)).toMatch(/not available/i);
  });

  it("opens the address modal for a genuine rail", async () => {
    const r = await handlePaymentsConsole(
      interaction({
        data: { custom_id: id("wallet_address", "USDC"), values: ["EVM|base"] },
      }) as never
    );
    // Type 9 is MODAL. The address is typed into a modal so it never appears
    // in the channel at all.
    expect(r!.type).toBe(9);
  });

  it("requires an identity before showing an account screen", async () => {
    // No member and no user on the envelope means there is nobody to resolve
    // an account for. It now fails in the identity layer rather than in the
    // router, so the message names the missing thing rather than the server.
    const r = await handlePaymentsConsole({
      type: 3,
      data: { custom_id: id("home") },
    } as never);
    expect(JSON.stringify(r)).toMatch(/carried no Discord user/i);
  });
});

describe("wallet confirmation renders the real validation", () => {
  it("shows Taproot and does not ask to confirm a network", () => {
    const screen = walletConfirmScreen(
      "BITCOIN_ONCHAIN",
      "bitcoin:mainnet",
      "bc1p0xlxvlhemja6c4dqv22uapctqupfhlxm9h8z3k2e72q4k9hcz7vqzk5jj0"
    );
    const body = JSON.stringify(screen);
    expect(body).toMatch(/Taproot/);
    expect(body).toMatch(/encodes its own network/i);
    // Bitcoin cannot be ownership-verified yet, and the screen says so.
    expect(body).toMatch(/cannot yet prove control/i);
  });

  it("demands explicit network confirmation for an EVM address", () => {
    const body = JSON.stringify(
      walletConfirmScreen("EVM", "base", "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")
    );
    expect(body).toMatch(/will not guess/i);
  });

  it("shows the rejection reason for a bad address", () => {
    const body = JSON.stringify(walletConfirmScreen("EVM", "base", "0xnope"));
    expect(body).toMatch(/not accepted/i);
  });

  it("masks the address rather than printing it in full", () => {
    const addr = "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045";
    const body = JSON.stringify(walletConfirmScreen("EVM", "base", addr));
    expect(body).not.toContain(addr);
    expect(body).toContain("•");
  });
});

describe("no emoji anywhere", () => {
  it("keeps every rendered screen free of emoji", () => {
    // FurlPay's voice is plain, and an emoji in a financial confirmation makes
    // it read like a game. Status is carried by words, which also survive a
    // screen reader.
    const emoji =
      /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}]/u;
    const screens = [
      JSON.stringify(homeScreen({
        availableAtomic: "1284500000",
        pendingAtomic: "320000000",
        lifetimeAtomic: "8942500000",
        decimals: 6,
        currency: "USDC",
        lastPayout: null,
        payoutsFrozen: false,
      })),
      JSON.stringify(walletConfirmScreen("EVM", "base", "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045")),
    ];
    for (const s of screens) expect(s).not.toMatch(emoji);
  });
});

describe("money formatting", () => {
  it("formats atomic units without floating point", () => {
    expect(formatAtomic("1284500000", 6, "USDC")).toBe("1,284.500000 USDC");
    expect(formatAtomic("0", 6)).toBe("0.000000");
    expect(formatAtomic("1", 8)).toBe("0.00000001");
  });

  it("stays exact beyond 2^53", () => {
    // The number that breaks a float-based formatter. String arithmetic does
    // not care how large the balance is.
    expect(formatAtomic("9007199254740993", 6)).toBe("9,007,199,254.740993");
  });

  it("handles a negative correction without mangling it", () => {
    expect(formatAtomic("-500000", 6, "USDC")).toBe("-0.500000 USDC");
  });
});

describe("custom_id parsing", () => {
  it("round-trips a step and its arguments", () => {
    expect(parseId(id("wallet_rail", "USDC"))).toEqual({ step: "wallet_rail", args: ["USDC"] });
    expect(parseId(id("home"))).toEqual({ step: "home", args: [] });
  });

  it("returns null for a foreign id", () => {
    expect(parseId("verify:start")).toBeNull();
  });

  it("stays inside Discord's 100-character custom_id limit", () => {
    const longest = id("wallet_address", "BITCOIN_ONCHAIN", "bitcoin:mainnet");
    expect(longest.length).toBeLessThanOrEqual(100);
  });
});
