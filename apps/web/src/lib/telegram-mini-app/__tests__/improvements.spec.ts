import { describe, it, expect } from "vitest";
import { activityFilter, addressFromQr, checkoutPath } from "../contracts";
import { handleUpdate, type TgUpdate } from "@/lib/telegram";

const PATH = "/p/" + "a".repeat(24);
const ADDRESS = "0x209693Bc6afc0C5328bA36FaF03C514EF312287C";

describe("checkoutPath: the forms people actually paste", () => {
  it("accepts a full link, a bare domain link and a relative path", () => {
    for (const typed of [
      "https://furlpay.com" + PATH,
      "https://www.furlpay.com" + PATH,
      "furlpay.com" + PATH,
      "www.furlpay.com" + PATH,
      "FurlPay.com" + PATH,
      PATH,
      "  " + PATH + "  ",
      PATH + "?amount=1",
    ]) {
      expect(checkoutPath(typed), typed).toBe(PATH);
    }
  });

  it("still opens nothing that is not FurlPay's own checkout", () => {
    for (const typed of [
      "//evil.test" + PATH,
      "/\\evil.test" + PATH,
      "https://evil.test" + PATH,
      "http://furlpay.com" + PATH,
      "furlpay.com.evil.test" + PATH,
      "furlpay.com@evil.test" + PATH,
      "evil.test/furlpay.com" + PATH,
      "javascript:alert(1)",
      "/p/short",
      "/p/" + "a".repeat(24) + "/../../admin",
      "/profile",
      PATH + "#secret",
      "",
    ]) {
      expect(checkoutPath(typed), typed).toBeNull();
    }
  });
});

describe("addressFromQr: the address and nothing else", () => {
  it("reads a bare address and the EIP-681 forms wallets show", () => {
    for (const text of [
      ADDRESS,
      ` ${ADDRESS}\n`,
      `ethereum:${ADDRESS}`,
      `ethereum:${ADDRESS}@42161`,
      `ethereum:pay-${ADDRESS}@8453?value=1e18`,
      `ethereum:${ADDRESS}/transfer?address=0x000000000000000000000000000000000000dEaD&uint256=1`,
    ]) {
      expect(addressFromQr(text), text).toBe(ADDRESS);
    }
  });

  it("never takes an amount, a chain or a second address from the code", () => {
    const text = `ethereum:${ADDRESS}@1/transfer?address=0x000000000000000000000000000000000000dEaD&uint256=999`;
    expect(addressFromQr(text)).toBe(ADDRESS);
  });

  it("refuses everything that is not an EVM address", () => {
    for (const text of [
      "",
      "0x1234",
      ADDRESS + "00",
      "bitcoin:bc1qxy2kgdygjrsqtzq2n0yrf2493p83kkfjhx0wlh",
      "https://evil.test/" + ADDRESS,
      "solana:7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU",
      `ethereum:${ADDRESS}xyz`,
      `javascript:${ADDRESS}`,
    ]) {
      expect(addressFromQr(text), text).toBeNull();
    }
  });
});

describe("activityFilter", () => {
  it("opens the tab a deep link names", () => {
    for (const id of ["all", "card", "transfer", "ramp", "bill"]) expect(activityFilter(id)).toBe(id);
  });
  it("opens All for anything unknown", () => {
    for (const v of [undefined, null, "", "cards", "__proto__", "constructor"]) expect(activityFilter(v)).toBe("all");
  });
});

describe("bot: opening the Mini App", () => {
  const update = (text: string, type: string): TgUpdate => ({
    message: { message_id: 1, text, chat: { id: 42, type }, from: { first_name: "Sam" } },
  });
  const buttons = (reply: Awaited<ReturnType<typeof handleUpdate>>) =>
    ((reply?.reply_markup as { inline_keyboard: Record<string, unknown>[][] }).inline_keyboard ?? []).flat();

  it("/app in a private chat opens the Mini App inside Telegram", async () => {
    for (const cmd of ["/app", "/app@furlpay_bot"]) {
      const reply = await handleUpdate(update(cmd, "private"));
      expect(buttons(reply)).toEqual([{ text: "Open FurlPay", web_app: { url: "https://furlpay.com/telegram" } }]);
    }
  });

  it("never sends a web_app button to a group, where Telegram rejects the message", async () => {
    for (const type of ["group", "supergroup", "channel"]) {
      for (const cmd of ["/app", "/start"]) {
        const all = buttons(await handleUpdate(update(cmd, type)));
        expect(all.length).toBeGreaterThan(0);
        for (const b of all) {
          expect(b).not.toHaveProperty("web_app");
          expect(String(b.url)).toMatch(/^https:\/\/(furlpay\.com|t\.me|github\.com)\//);
        }
      }
    }
  });

  it("/start in a private chat leads with the Mini App button", async () => {
    const all = buttons(await handleUpdate(update("/start", "private")));
    expect(all[0]).toEqual({ text: "Open FurlPay", web_app: { url: "https://furlpay.com/telegram" } });
  });
});
