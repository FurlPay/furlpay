/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { quoteStay } from "@/lib/travel/data";

let search = new URLSearchParams();
vi.mock("next/navigation", () => ({ useSearchParams: () => search }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));
vi.mock("@/components/travel/EntryRequirementsCheck", () => ({ default: () => null }));

import CheckoutPage from "../page";

type Call = { url: string; init?: RequestInit };
let calls: Call[];
let overview: { status: number; body: unknown };
let book: { status: number; body: unknown };

beforeEach(() => {
  calls = [];
  overview = { status: 200, body: { tokenBalances: [{ token: "USDC", amount: 5000 }, { token: "SOL", amount: 3 }] } };
  book = { status: 503, body: { error: "not_available", detail: "x" } };
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      const r = url.includes("/api/overview") ? overview : book;
      return new Response(JSON.stringify(r.body), { status: r.status, headers: { "content-type": "application/json" } });
    })
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const open = (q: string) => {
  search = new URLSearchParams(q);
  return render(<CheckoutPage />);
};

describe("checkout shows only real values", () => {
  it("no amount in the URL → no checkout, not an invented $540", () => {
    open("kind=stay&name=Somewhere");
    expect(screen.getByText("Nothing to check out")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\$540/);
  });

  it("total matches the server's quoteStay for the same subtotal", () => {
    open("kind=stay&ref=h1&name=Harbour%20Hotel&amount=300&nights=2");
    const q = quoteStay(300);
    expect(screen.getAllByText(`$${q.totalUsd.toFixed(2)}`).length).toBeGreaterThan(0);
    expect(screen.getByText("Room rate (2 nights)")).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/adults?/);
  });

  it("labels activities and cars as what they are", () => {
    open("kind=car&ref=c1&name=Compact&amount=90&nights=3");
    expect(screen.getByText("Rental (3 days)")).toBeTruthy();
    cleanup();
    open("kind=activity&ref=a1&name=Tour&amount=40&nights=1");
    expect(screen.getByText("Experience")).toBeTruthy();
  });

  it("FurlPay balance is the account's real USDC balance", async () => {
    open("kind=stay&ref=h1&name=H&amount=100&nights=1");
    await waitFor(() => expect(screen.getByText(/Available: 5,000 USDC/)).toBeTruthy());
  });

  it("signed out → balance option disabled with a reason", async () => {
    overview = { status: 401, body: { error: "unauthorized" } };
    open("kind=stay&ref=h1&name=H&amount=100&nights=1");
    await waitFor(() => expect(screen.getByText("Sign in to pay from your balance")).toBeTruthy());
    expect((screen.getByRole("radio", { name: /FurlPay balance/i }) as HTMLInputElement).disabled).toBe(true);
  });
});

describe("payment networks", () => {
  it("Visa mark only on the virtual card; no Mastercard or Amex claims anywhere", () => {
    open("kind=stay&ref=h1&name=H&amount=100&nights=1");
    expect(screen.getAllByRole("img", { name: /visa/i })).toHaveLength(1);
    expect(document.body.textContent).not.toMatch(/Mastercard|Amex|American Express/i);
  });

  it("credit / debit card is shown as not connected and cannot be selected", () => {
    open("kind=stay&ref=h1&name=H&amount=100&nights=1");
    const card = screen.getByRole("radio", { name: /credit \/ debit card/i }) as HTMLInputElement;
    expect(card.disabled).toBe(true);
    expect(screen.getByText(/no card processor/i)).toBeTruthy();
  });
});

describe("selection, terms and submission", () => {
  it("methods are a radio group; selecting one checks it", () => {
    open("kind=stay&ref=h1&name=H&amount=100&nights=1");
    const vcard = screen.getByRole("radio", { name: /one-time virtual card/i }) as HTMLInputElement;
    fireEvent.click(vcard);
    expect(vcard.checked).toBe(true);
    expect((screen.getByRole("radio", { name: /crypto wallet/i }) as HTMLInputElement).checked).toBe(false);
  });

  it("booking is disabled until the terms are accepted", () => {
    open("kind=stay&ref=h1&name=H&amount=100&nights=1");
    const pay = screen.getByRole("button", { name: /complete booking/i }) as HTMLButtonElement;
    expect(pay.disabled).toBe(true);
    fireEvent.click(screen.getByLabelText(/travel terms/i));
    expect(pay.disabled).toBe(false);
  });

  it("sends the subtotal (server prices it) with an idempotency key, and reports a 503 honestly", async () => {
    open("kind=stay&ref=h1&name=H&amount=100&nights=2");
    fireEvent.click(screen.getByLabelText(/travel terms/i));
    const pay = screen.getByRole("button", { name: /complete booking/i });
    fireEvent.click(pay);
    fireEvent.click(pay); // a double click must not send twice
    await waitFor(() => expect(screen.getByRole("alert").textContent).toMatch(/isn't available yet.*not charged/i));
    const posts = calls.filter((c) => c.url === "/api/travel/book");
    expect(posts).toHaveLength(1);
    const body = JSON.parse(String(posts[0].init!.body));
    expect(body).toMatchObject({ subtotalUsd: 100, source: "travala", nights: 2, reference: "h1" });
    expect(body.idempotencyKey).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.amountUsd).toBeUndefined();
  });

  it("a successful booking shows the confirmation, flagged when simulated", async () => {
    book = {
      status: 200,
      body: { booking: { id: "bk_1", authorization: { route: "travala", cashbackUsd: 2.2, simulated: true, x402: { proof: "x402_sim_abcdefgh", network: "base" } } } },
    };
    open("kind=stay&ref=h1&name=H&amount=100&nights=1");
    fireEvent.click(screen.getByLabelText(/travel terms/i));
    fireEvent.click(screen.getByRole("button", { name: /complete booking/i }));
    await waitFor(() => expect(screen.getByText("Booking confirmed")).toBeTruthy());
    expect(screen.getByText(/simulated\. Nothing was charged/i)).toBeTruthy();
  });
});
