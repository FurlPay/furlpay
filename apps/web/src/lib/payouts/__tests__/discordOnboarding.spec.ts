import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  STEP_ORDER,
  completeStep,
  completeWalletStep,
  getState,
  isVerified,
  issueStepToken,
  nextStep,
} from "../discord/onboarding";
import { handlePaymentsConsole } from "../discord/handler";
import { id } from "../discord/console";

// ---------------------------------------------------------------------------
// DM verification, before any money is visible.
//
// A guild member is not a verified FurlPay user. Membership proves someone
// clicked an invite link; a payout console that opened on that alone would
// hand an account to anyone who joined.
//
// The properties under test:
//   1. nothing financial is reachable before every step is done
//   2. a token issued to A cannot be used by B, even to probe the answer
//   3. a correct submission cannot be replayed
//   4. progress survives moving between the server and a DM
//   5. verification is durable — it does not silently expire
// ---------------------------------------------------------------------------

const GUILD = "1522006337070825482";
const USER_A = "111111111111111111";
const USER_B = "222222222222222222";

beforeEach(() => {
  process.env.DISCORD_GUILD_ID = GUILD;
  // No bot token in tests: sendDm fails "not_configured", which the handler
  // must degrade from without ever leaking a balance into the channel.
  delete process.env.DISCORD_BOT_TOKEN;
  const g = globalThis as unknown as { __furlpayKv?: Map<string, unknown> };
  g.__furlpayKv?.clear();
});

/** Drive a user all the way through verification. */
async function verifyFully(discordUserId: string) {
  for (const step of ["captcha", "email", "phone"] as const) {
    const t = await issueStepToken(discordUserId, step);
    const r = await completeStep({ tokenId: t.id, discordUserId, answer: t.secret });
    expect(r.ok, step).toBe(true);
  }
  await completeWalletStep(discordUserId, "0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045");
  return getState(discordUserId);
}

describe("the step sequence", () => {
  it("starts unverified with captcha first", async () => {
    const s = await getState(USER_A);
    expect(s.status).toBe("unverified");
    expect(nextStep(s)).toBe("captcha");
    // Cheapest and most anonymous first: a raid script should be turned away
    // before it is asked for an email address.
    expect(STEP_ORDER[0]).toBe("captcha");
  });

  it("advances one step at a time and finishes verified", async () => {
    const s = await verifyFully(USER_A);
    expect(s.status).toBe("verified");
    expect(isVerified(s)).toBe(true);
    expect(nextStep(s)).toBeNull();
    expect(s.verifiedAt).not.toBeNull();
  });

  it("records the proven values but never as identity keys", async () => {
    const t = await issueStepToken(USER_A, "captcha");
    await completeStep({ tokenId: t.id, discordUserId: USER_A, answer: t.secret });
    // The destination is bound to the TOKEN at issue time, not submitted with
    // the answer. Otherwise someone could receive a code at an address they
    // control and submit a different one — recording an identity they never
    // proved.
    const e = await issueStepToken(USER_A, "email", "a@example.com");
    const r = await completeStep({
      tokenId: e.id,
      discordUserId: USER_A,
      answer: e.secret,
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.email).toBe("a@example.com");
  });
});

describe("tokens are bound to one person", () => {
  it("refuses a token issued to somebody else, before checking the answer", async () => {
    // THE REPLAY CASE. Components round-trip through the client, so a token id
    // can be copied out of another member's DM. Binding is checked first so
    // the wrong holder cannot even learn whether their guess was right.
    const t = await issueStepToken(USER_A, "captcha");
    const r = await completeStep({ tokenId: t.id, discordUserId: USER_B, answer: t.secret });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("wrong_user");
  });

  it("does not advance the victim's state when someone else submits", async () => {
    const t = await issueStepToken(USER_A, "captcha");
    await completeStep({ tokenId: t.id, discordUserId: USER_B, answer: t.secret });
    const a = await getState(USER_A);
    expect(a.completed).toHaveLength(0);
  });

  it("consumes the token so a correct submission cannot be replayed", async () => {
    const t = await issueStepToken(USER_A, "captcha");
    const first = await completeStep({ tokenId: t.id, discordUserId: USER_A, answer: t.secret });
    expect(first.ok).toBe(true);

    const replay = await completeStep({ tokenId: t.id, discordUserId: USER_A, answer: t.secret });
    expect(replay.ok).toBe(false);
    if (!replay.ok) expect(replay.reason).toBe("unknown_token");
  });

  it("caps wrong answers and then burns the token", async () => {
    const t = await issueStepToken(USER_A, "captcha");
    const r1 = await completeStep({ tokenId: t.id, discordUserId: USER_A, answer: "WRONG1" });
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.attemptsLeft).toBe(2);

    await completeStep({ tokenId: t.id, discordUserId: USER_A, answer: "WRONG2" });
    const r3 = await completeStep({ tokenId: t.id, discordUserId: USER_A, answer: "WRONG3" });
    expect(r3.ok).toBe(false);
    if (!r3.ok) expect(r3.reason).toBe("exhausted");

    // And the burned token cannot then be used with the RIGHT answer.
    const after = await completeStep({ tokenId: t.id, discordUserId: USER_A, answer: t.secret });
    expect(after.ok).toBe(false);
  });

  it("rejects an unknown token id", async () => {
    const r = await completeStep({
      tokenId: "deadbeef".repeat(4),
      discordUserId: USER_A,
      answer: "ABC123",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("unknown_token");
  });

  it("is idempotent when a step is completed twice by delivery duplication", async () => {
    const t1 = await issueStepToken(USER_A, "captcha");
    await completeStep({ tokenId: t1.id, discordUserId: USER_A, answer: t1.secret });
    const t2 = await issueStepToken(USER_A, "captcha");
    const r = await completeStep({ tokenId: t2.id, discordUserId: USER_A, answer: t2.secret });
    // Already done — a duplicate Discord delivery must not read as a failure.
    expect(r.ok).toBe(true);
    const s = await getState(USER_A);
    expect(s.completed.filter((c) => c === "captcha")).toHaveLength(1);
  });
});

describe("progress is per person and survives the move to a DM", () => {
  it("keeps two members' progress separate", async () => {
    const t = await issueStepToken(USER_A, "captcha");
    await completeStep({ tokenId: t.id, discordUserId: USER_A, answer: t.secret });

    expect((await getState(USER_A)).completed).toContain("captcha");
    expect((await getState(USER_B)).completed).toHaveLength(0);
  });

  it("continues the same run in a DM as in the server", async () => {
    // Progress is keyed on the snowflake alone, never the guild, so moving
    // channels does not restart verification as a second identity.
    const t = await issueStepToken(USER_A, "captcha");
    await completeStep({ tokenId: t.id, discordUserId: USER_A, answer: t.secret });
    const s = await getState(USER_A);
    expect(nextStep(s)).toBe("email");
  });
});

describe("the console is gated", () => {
  const guildCommand = (userId: string) => ({
    type: 2,
    guild_id: GUILD,
    member: { user: { id: userId, username: "member" } },
    data: { name: "payments" },
  });
  const dmCommand = (userId: string) => ({
    type: 2,
    user: { id: userId, username: "member" },
    data: { name: "payments" },
  });

  it("shows no balance to an unverified member in the server", async () => {
    const r = await handlePaymentsConsole(guildCommand(USER_A) as never);
    const body = JSON.stringify(r);
    // The public-channel entry point must never carry money, even ephemerally
    // — and certainly not before the member is verified.
    expect(body).not.toMatch(/Available|Lifetime|Pending/);
    expect((r!.data as { flags?: number }).flags).toBe(1 << 6);
  });

  it("does not need a DM to be deliverable at all", async () => {
    // SUPERSEDES an earlier test that asserted the opposite: that with no bot
    // token the member should be told how to enable DMs. That was accepting a
    // broken design. Whether a member can receive DMs is not a precondition
    // for verifying them, so the gate no longer asks — it just renders the
    // step in the ephemeral reply the member is already looking at.
    const r = await handlePaymentsConsole(guildCommand(USER_A) as never);
    const body = JSON.stringify(r);
    expect(body).not.toMatch(/could not start verification/i);
    expect(body).not.toMatch(/direct message/i);
    expect(body).toMatch(/Verify you are a person/i);
  });

  it("renders the next step inline when the member is already in a DM", async () => {
    const r = await handlePaymentsConsole(dmCommand(USER_A) as never);
    const body = JSON.stringify(r);
    expect(body).toMatch(/Verify you are a person/i);
    expect(body).toMatch(/Step 1 of 4/);
  });

  it("opens the console once every step is done", async () => {
    await verifyFully(USER_B);
    const r = await handlePaymentsConsole(dmCommand(USER_B) as never);
    const body = JSON.stringify(r);
    expect(body).toMatch(/Payments Center/i);
    expect(body).not.toMatch(/Verify you are a person/i);
  });

  it("never asks a verified member to verify again", async () => {
    await verifyFully(USER_B);
    const first = await handlePaymentsConsole(guildCommand(USER_B) as never);
    const second = await handlePaymentsConsole(guildCommand(USER_B) as never);
    for (const r of [first, second]) {
      expect(JSON.stringify(r)).not.toMatch(/Step 1 of 4/);
    }
  });

  it("keeps one member's verification from unlocking another's console", async () => {
    await verifyFully(USER_A);
    // B has done nothing.
    const r = await handlePaymentsConsole(dmCommand(USER_B) as never);
    expect(JSON.stringify(r)).toMatch(/Verify you are a person/i);
  });

  it("never leaks a verification code into a reply", async () => {
    const t = await issueStepToken(USER_A, "email");
    const r = await handlePaymentsConsole(dmCommand(USER_A) as never);
    // The email/phone code is delivered out of band. Rendering it back in
    // Discord would defeat the point of proving the other channel.
    expect(JSON.stringify(r)).not.toContain(t.secret);
  });
});

describe("hardening found by audit", () => {
  it("never produces a code with predictable padding", async () => {
    // The old randomCode drew a fixed byte budget, rejection-sampled, then
    // padEnd'd with the alphabet's first character — so a run of rejections
    // ended the code in "A"s. Over many draws the last character must vary.
    const lasts = new Set<string>();
    for (let n = 0; n < 200; n++) {
      const t = await issueStepToken(`code-probe-${n}`, "captcha");
      expect(t.secret).toHaveLength(6);
      lasts.add(t.secret.slice(-1));
    }
    expect(lasts.size).toBeGreaterThan(5);
  });

  it("holds the attempt cap when wrong guesses race", async () => {
    // Read-then-write let simultaneous submissions observe the same count and
    // write back the same increment, spending three attempts as six. The
    // counter is now a single atomic INCR.
    const t = await issueStepToken(USER_A, "captcha");
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        completeStep({ tokenId: t.id, discordUserId: USER_A, answer: "WRONGX" })
      )
    );
    expect(results.every((r) => !r.ok)).toBe(true);

    // Whatever the interleaving, the token must be dead — the correct answer
    // no longer works.
    const after = await completeStep({ tokenId: t.id, discordUserId: USER_A, answer: t.secret });
    expect(after.ok).toBe(false);
  });

  it("rate-limits token issuance per member", async () => {
    // Without a budget a script could mint endlessly — and once delivery is
    // wired, aim FurlPay's mailer at any address it liked.
    const { issueStep } = await import("../discord/onboarding");
    const user = "rate-limited-user";
    const outcomes = [];
    for (let n = 0; n < 8; n++) outcomes.push(await issueStep(user, "captcha"));

    expect(outcomes.some((o) => !o.ok && o.reason === "rate_limited")).toBe(true);
    expect(outcomes.filter((o) => o.ok).length).toBeLessThanOrEqual(5);
  });

  it("reports honestly when a code could not be delivered", async () => {
    // sendEmail degrades to a console log with no provider key. A member
    // cannot read a server log, so claiming success would leave them waiting
    // for a code that was never sent.
    const { issueStep } = await import("../discord/onboarding");
    const r = await issueStep("delivery-probe", "email", "nobody@example.com");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.delivered).toBe("not_delivered");
  });

  it("refuses to send an email code with no address", async () => {
    const { issueStep } = await import("../discord/onboarding");
    const r = await issueStep("no-address-user", "email");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("delivery_failed");
  });
});

describe("the verification gate does not depend on DMs", () => {
  // THE PRODUCTION OUTAGE THIS ENCODES.
  //
  // The gate used to open a DM and tell the member to go and read it. The bot
  // token lived only in a gitignored .env.local, so on Vercel there was no
  // token, every sendDm failed, and every member who tried to use the bot got
  // "FurlPay could not start verification just now" forever. The feature was
  // completely unreachable in production while every test passed locally,
  // because locally the token was there.
  //
  // So the test deletes the token rather than setting one. If the gate ever
  // starts needing a credential again, this fails.
  const guildClick = () => ({
    type: 3,
    guild_id: "1522006337070825482",
    member: { user: { id: "770000000000000001", username: "isaac" } },
    message: { flags: 0 },
    data: { custom_id: id("home") },
  });

  let savedToken: string | undefined;
  beforeEach(() => {
    savedToken = process.env.DISCORD_BOT_TOKEN;
    delete process.env.DISCORD_BOT_TOKEN;
    process.env.DISCORD_GUILD_ID = "1522006337070825482";
  });
  afterEach(() => {
    if (savedToken === undefined) delete process.env.DISCORD_BOT_TOKEN;
    else process.env.DISCORD_BOT_TOKEN = savedToken;
  });

  it("serves the first verification step with no bot token configured", async () => {
    const r = await handlePaymentsConsole(guildClick() as never);
    const body = JSON.stringify(r);
    expect(body).not.toMatch(/could not start verification/i);
    expect(body).not.toMatch(/check your direct messages/i);
    // The member gets the actual step, in the reply, immediately.
    expect(body).toMatch(/verif/i);
  });

  it("answers ephemerally, so a channel click stays private", async () => {
    const r = await handlePaymentsConsole(guildClick() as never);
    expect((r!.data as { flags?: number }).flags).toBe(1 << 6);
    // Type 4 = new private reply. Type 7 would rewrite the public message
    // everyone can see, which for a verification prompt would be a disclosure.
    expect(r!.type).toBe(4);
  });

  it("never tells a member to go and check their DMs", async () => {
    // Training members to expect a payments DM from us is training them to
    // trust the next one, which will be a drainer.
    const r = await handlePaymentsConsole(guildClick() as never);
    expect(JSON.stringify(r)).not.toMatch(/direct message/i);
  });
});
