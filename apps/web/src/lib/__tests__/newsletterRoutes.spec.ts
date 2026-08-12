// /api/newsletter/subscribe + /unsubscribe — drives the REAL routes.
//
// What only the routes have: Zod validation of a fully public body, durable
// persistence of the consent record, category merging on re-subscribe,
// selective vs full opt-out, and the promise that unsubscribe never reveals
// whether an address was on the list.

import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { POST as subscribePOST } from "@/app/api/newsletter/subscribe/route";
import { POST as unsubscribePOST } from "@/app/api/newsletter/unsubscribe/route";
import { getSubscriber } from "@/lib/newsletter";

let ipCounter = 0;
/** A fresh IP per request: the routes rate-limit per IP (5/min on subscribe),
 *  and a shared IP would make later assertions depend on test order. */
function nextIp(): string {
  ipCounter += 1;
  return `203.0.113.${ipCounter}`;
}

function req(path: string, body: unknown, ip = nextIp()): NextRequest {
  return new NextRequest(`https://furlpay.com/api/newsletter/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify(body),
  });
}

let emailCounter = 0;
const freshEmail = () => `reader-${(emailCounter += 1)}-${Date.now()}@furlpay.test`;

describe("POST /api/newsletter/subscribe", () => {
  it("rejects a missing email", async () => {
    const res = await subscribePOST(req("subscribe", { categories: ["engineering"] }));
    expect(res.status).toBe(400);
  });

  it("rejects a malformed email", async () => {
    const res = await subscribePOST(
      req("subscribe", { email: "not-an-address", categories: ["engineering"] })
    );
    expect(res.status).toBe(400);
  });

  it("rejects an unknown category instead of silently dropping it", async () => {
    const res = await subscribePOST(
      req("subscribe", { email: freshEmail(), categories: ["engineering", "crypto-shilling"] })
    );
    expect(res.status).toBe(400);
  });

  it("rejects an empty category list", async () => {
    const res = await subscribePOST(req("subscribe", { email: freshEmail(), categories: [] }));
    expect(res.status).toBe(400);
  });

  it("rejects a non-array categories field", async () => {
    const res = await subscribePOST(
      req("subscribe", { email: freshEmail(), categories: "engineering" })
    );
    expect(res.status).toBe(400);
  });

  it("stores a consent record that survives the request", async () => {
    const email = freshEmail();
    const res = await subscribePOST(
      req("subscribe", { email, categories: ["engineering", "weekly-digest"] }, "198.51.100.7")
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true });

    const stored = await getSubscriber(email);
    expect(stored).not.toBeNull();
    expect(stored!.categories.sort()).toEqual(["engineering", "weekly-digest"]);
    expect(stored!.ip).toBe("198.51.100.7");
    expect(Number.isNaN(Date.parse(stored!.consentTimestamp))).toBe(false);
  });

  it("normalizes the address so one person cannot become two records", async () => {
    const email = freshEmail();
    await subscribePOST(req("subscribe", { email: email.toUpperCase(), categories: ["engineering"] }));
    const stored = await getSubscriber(email);
    expect(stored?.email).toBe(email.toLowerCase());
  });

  it("de-duplicates repeated categories in one request", async () => {
    const email = freshEmail();
    await subscribePOST(
      req("subscribe", { email, categories: ["engineering", "engineering", "engineering"] })
    );
    expect((await getSubscriber(email))!.categories).toEqual(["engineering"]);
  });

  it("merges categories on re-subscribe rather than replacing them", async () => {
    const email = freshEmail();
    await subscribePOST(req("subscribe", { email, categories: ["engineering"] }));
    const res = await subscribePOST(req("subscribe", { email, categories: ["weekly-digest"] }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toMatchObject({ success: true });
    expect((await getSubscriber(email))!.categories.sort()).toEqual(["engineering", "weekly-digest"]);
  });

  it("rate-limits a burst from one IP", async () => {
    const ip = "192.0.2.99";
    const codes: number[] = [];
    for (let i = 0; i < 7; i++) {
      const res = await subscribePOST(req("subscribe", { email: freshEmail(), categories: ["engineering"] }, ip));
      codes.push(res.status);
    }
    expect(codes.filter((c) => c === 429).length).toBeGreaterThan(0);
  });
});

describe("POST /api/newsletter/unsubscribe", () => {
  it("does not reveal whether an unknown address was subscribed", async () => {
    const res = await unsubscribePOST(req("unsubscribe", { email: freshEmail() }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.message).toMatch(/if that email is subscribed/i);
  });

  it("removes only the selected categories", async () => {
    const email = freshEmail();
    await subscribePOST(
      req("subscribe", { email, categories: ["engineering", "weekly-digest", "product-updates"] })
    );

    const res = await unsubscribePOST(req("unsubscribe", { email, categories: ["engineering"] }));
    expect(res.status).toBe(200);

    const stored = await getSubscriber(email);
    expect(stored!.categories.sort()).toEqual(["product-updates", "weekly-digest"]);
  });

  it("deletes the record when the last category is removed", async () => {
    const email = freshEmail();
    await subscribePOST(req("subscribe", { email, categories: ["engineering"] }));

    const res = await unsubscribePOST(req("unsubscribe", { email, categories: ["engineering"] }));
    expect(res.status).toBe(200);
    expect(await getSubscriber(email)).toBeNull();
  });

  it("removes the record entirely when no categories are given", async () => {
    const email = freshEmail();
    await subscribePOST(req("subscribe", { email, categories: ["engineering", "weekly-digest"] }));

    const res = await unsubscribePOST(req("unsubscribe", { email }));
    expect(res.status).toBe(200);
    expect(await getSubscriber(email)).toBeNull();
  });

  it("rejects a malformed email", async () => {
    const res = await unsubscribePOST(req("unsubscribe", { email: "nope" }));
    expect(res.status).toBe(400);
  });

  it("rejects an unknown category", async () => {
    const res = await unsubscribePOST(
      req("unsubscribe", { email: freshEmail(), categories: ["everything"] })
    );
    expect(res.status).toBe(400);
  });
});
