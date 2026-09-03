import { describe, it, expect } from "vitest";
import { FURLPAY_RULES, buildRulesMessage, defaultChannels } from "../community";
import { VOICE_CHANNELS, CHANNEL_TEXT, CHANNEL_VOICE } from "../voice";
import { emojiName } from "../emoji";

// ---------------------------------------------------------------------------
// The rules are the one piece of copy every member is forced to read, so they
// are tested like code: the anti-scam clauses in particular exist because of a
// real DM sent to this server's owner, and must not quietly disappear.
// ---------------------------------------------------------------------------

describe("rules", () => {
  it("states plainly that FurlPay never DMs first or asks for a seed phrase", () => {
    const all = FURLPAY_RULES.join(" ");
    expect(all).toMatch(/never dm you first/i);
    expect(all).toMatch(/seed phrase/i);
    expect(all).toMatch(/private key/i);
  });

  it("covers the airdrop / verify-your-wallet scam explicitly", () => {
    const all = FURLPAY_RULES.join(" ");
    expect(all).toMatch(/airdrop/i);
    expect(all).toMatch(/verify your wallet/i);
  });

  it("never itself asks for a secret", () => {
    // The rules TALK about seed phrases and wallet addresses constantly — that
    // is their job. So the test bans the SOLICITATION, and a solicitation is a
    // request verb that is not negated. "Never send a wallet address" must
    // pass; "send a wallet address" must not.
    const text = JSON.stringify(buildRulesMessage());
    const requests = /(send|share|provide|reply with|dm us)[^.]{0,40}(seed phrase|private key|wallet address|password)/gi;
    for (const m of text.matchAll(requests)) {
      const lead = text.slice(Math.max(0, m.index - 40), m.index + m[0].length);
      expect(lead, `unnegated request: ${m[0]}`).toMatch(/never|not|don't|no\b/i);
    }
  });

  it("fits Discord's 4096-character embed description limit", () => {
    const msg = buildRulesMessage();
    const desc = (msg.embeds as { description: string }[])[0]!.description;
    expect(desc.length).toBeLessThan(4096);
    expect(FURLPAY_RULES.length).toBeGreaterThanOrEqual(6);
  });

  it("numbers every rule", () => {
    const desc = (buildRulesMessage().embeds as { description: string }[])[0]!.description;
    for (let i = 1; i <= FURLPAY_RULES.length; i++) expect(desc).toContain(`**${i}.**`);
  });

  it("pings nobody", () => {
    expect(buildRulesMessage().allowed_mentions).toEqual({ parse: [] });
  });
});

describe("onboarding defaults", () => {
  const chans = [
    { id: "1", name: "💬︱general", type: CHANNEL_TEXT },
    { id: "2", name: "introductions", type: CHANNEL_TEXT },
    { id: "3", name: "developer-chat", type: CHANNEL_TEXT },
    { id: "4", name: "showcase", type: CHANNEL_TEXT },
    { id: "5", name: "feedback", type: CHANNEL_TEXT },
    { id: "6", name: "payments", type: CHANNEL_TEXT },
    { id: "7", name: "investing", type: CHANNEL_TEXT },
    { id: "8", name: "Lounge", type: CHANNEL_VOICE },
  ];

  it("matches channels whose names carry an emoji prefix", () => {
    // Every channel on this server is named like "💬︱general", so an exact
    // match would find nothing and onboarding would fail its 7-channel check
    // with an opaque 400.
    expect(defaultChannels(chans)).toContain("1");
  });

  it("picks only text channels", () => {
    expect(defaultChannels(chans)).not.toContain("8");
  });

  it("finds enough channels to satisfy Discord's minimum of 7", () => {
    expect(defaultChannels(chans).length).toBeGreaterThanOrEqual(7);
  });

  it("never repeats a channel", () => {
    const picked = defaultChannels(chans);
    expect(new Set(picked).size).toBe(picked.length);
  });
});

describe("voice catalog", () => {
  it("has unique names and sane limits", () => {
    const names = VOICE_CHANNELS.map((v) => v.name.toLowerCase());
    expect(new Set(names).size).toBe(names.length);
    for (const v of VOICE_CHANNELS) expect(v.userLimit).toBeGreaterThanOrEqual(0);
  });
});

describe("emoji naming", () => {
  it("produces Discord-legal names", () => {
    expect(emojiName("finance-expert")).toBe("furlpay_finance_expert");
    expect(emojiName("finance-expert")).toMatch(/^[A-Za-z0-9_]{2,32}$/);
  });
});
