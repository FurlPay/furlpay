import { describe, expect, it } from "vitest";
import { NextRequest, NextResponse } from "next/server";
import {
  clearSessionCookie,
  setSessionCookieForRequest,
  sessionCookieFromRequest,
  setTelegramEmbedContextCookie,
  setTelegramSessionCookie,
  TELEGRAM_EMBED_CONTEXT_COOKIE,
  TELEGRAM_SESSION_COOKIE,
  tokenFromRequest,
} from "@/lib/session";

describe("Telegram Web partitioned sessions", () => {
  it("sets an HttpOnly, Secure, SameSite=None partitioned context marker", () => {
    const response = NextResponse.json({ ok: true });
    setTelegramEmbedContextCookie(response);
    expect(response.cookies.get(TELEGRAM_EMBED_CONTEXT_COOKIE)?.value).toBe("1");
    expect(response.headers.get("set-cookie")).toMatch(/HttpOnly/i);
    expect(response.headers.get("set-cookie")).toMatch(/Secure/i);
    expect(response.headers.get("set-cookie")).toMatch(/SameSite=None/i);
    expect(response.headers.get("set-cookie")).toMatch(/Partitioned/i);
  });

  it("keeps the embedded credential partitioned and available to the same account routes", () => {
    const response = NextResponse.json({ ok: true });
    setTelegramSessionCookie(response, "signed.jwt");
    expect(response.cookies.get(TELEGRAM_SESSION_COOKIE)?.value).toBe("signed.jwt");
    expect(response.headers.get("set-cookie")).toMatch(/Path=\//i);
    expect(response.headers.get("set-cookie")).toMatch(/Partitioned/i);

    const miniRequest = new NextRequest("https://furlpay.com/api/miniapp/account", {
      headers: { cookie: `${TELEGRAM_SESSION_COOKIE}=signed.jwt` },
    });
    expect(tokenFromRequest(miniRequest)).toBe("signed.jwt");
    expect(sessionCookieFromRequest(miniRequest)).toBe("signed.jwt");

    const accountApiRequest = new NextRequest("https://furlpay.com/api/profile", {
      headers: { cookie: `${TELEGRAM_SESSION_COOKIE}=signed.jwt` },
    });
    expect(tokenFromRequest(accountApiRequest)).toBe("signed.jwt");

    const appPageRequest = new NextRequest("https://furlpay.com/profile", {
      headers: { cookie: `${TELEGRAM_SESSION_COOKIE}=signed.jwt` },
    });
    expect(tokenFromRequest(appPageRequest)).toBe("signed.jwt");
  });

  it("uses a partitioned cookie after verified Telegram context and a Lax cookie otherwise", () => {
    const embedded = new NextRequest("https://furlpay.com/api/auth/otp/check", {
      headers: { cookie: `${TELEGRAM_EMBED_CONTEXT_COOKIE}=1` },
    });
    const embeddedResponse = NextResponse.json({ ok: true });
    setSessionCookieForRequest(embedded, embeddedResponse, "embedded.jwt");
    expect(embeddedResponse.cookies.get(TELEGRAM_SESSION_COOKIE)?.value).toBe("embedded.jwt");
    expect(embeddedResponse.cookies.get("furlpay_session")).toBeUndefined();
    expect(embeddedResponse.headers.get("set-cookie")).toMatch(/Partitioned/i);

    const browser = new NextRequest("https://furlpay.com/api/auth/otp/check");
    const browserResponse = NextResponse.json({ ok: true });
    setSessionCookieForRequest(browser, browserResponse, "browser.jwt");
    expect(browserResponse.cookies.get("furlpay_session")?.value).toBe("browser.jwt");
    expect(browserResponse.headers.get("set-cookie")).toMatch(/SameSite=Lax/i);
    expect(browserResponse.headers.get("set-cookie")).not.toMatch(/Partitioned/i);
  });

  it("clears both first-party and partitioned session cookies on logout", () => {
    const response = NextResponse.json({ ok: true });
    clearSessionCookie(response);
    expect(response.cookies.get("furlpay_session")?.maxAge).toBe(0);
    expect(response.cookies.get(TELEGRAM_SESSION_COOKIE)?.maxAge).toBe(0);
    expect(response.headers.get("set-cookie")).toMatch(/Partitioned/i);
  });
});
