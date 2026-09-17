// Card routes must not disagree with the issuer.
//
// Before the issuer seam, freezing a card flipped a local boolean and returned
// 200. The customer saw a frozen card; the network went on authorising it. For
// a control whose entire purpose is to stop spend, reporting success you did
// not achieve is the worst available outcome — worse than an error, because an
// error at least sends someone to support.
//
// These drive the REAL routes with a REAL session, and mock only the issuer, so
// what is under test is the route's decision: what it changes, what it reports,
// and what it does when the issuer says no.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";

const setCardStatus = vi.fn();
vi.mock("@/lib/cardIssuer", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/cardIssuer")>();
  return {
    ...actual,
    // Simulation is allowed in test, so the routes take the propagating path.
    cardSimulationAllowed: () => true,
    getCardIssuer: () => ({
      id: "test",
      kind: "issuing" as const,
      issueCard: vi.fn(),
      getCard: vi.fn(),
      setCardStatus,
      getCardSecrets: vi.fn(),
      parseAuthorizationRequest: vi.fn(),
      encodeAuthorizationDecision: vi.fn(),
    }),
  };
});

const { POST: settingsPOST } = await import("@/app/api/cards/settings/route");
const { signSession } = await import("@/lib/session");
const { findOrCreateUserByIdentity } = await import("@/lib/store");

async function actorWithCard(providerCardRef?: string) {
  const email = `card-${randomUUID()}@furlpay.test`;
  const { account } = findOrCreateUserByIdentity({ email, name: "Card User" });
  const token = await signSession({ sub: account.user.id, safe: "0x0", roles: ["user"], jti: randomUUID() });
  const card = {
    id: "card_" + randomUUID().slice(0, 10),
    ...(providerCardRef ? { providerCardRef } : {}),
    kind: "virtual" as const,
    label: "Test",
    last4: "4242",
    network: "Visa" as const,
    frozen: false,
    gradient: ["#000", "#111"] as [string, string],
    limits: { perPurchase: 2500, daily: 5000, dailySpent: 0 },
    channels: { online: true, offline: false, atm: false },
    settlementCurrency: "USD",
  };
  account.cards.push(card);
  return { account, token, card };
}

function settingsReq(token: string, body: unknown) {
  return new NextRequest("https://furlpay.com/api/cards/settings", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      "x-forwarded-for": `10.9.0.${Math.floor(Math.random() * 250)}`,
    },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  setCardStatus.mockReset();
  setCardStatus.mockResolvedValue({});
});

describe("POST /api/cards/settings — freeze reaches the issuer", () => {
  it("tells the issuer to freeze, then records it locally", async () => {
    const { token, card } = await actorWithCard("rain_card_1");
    const res = await settingsPOST(settingsReq(token, { cardId: card.id, freeze: true }));

    expect(res.status).toBe(200);
    expect(setCardStatus).toHaveBeenCalledWith("rain_card_1", "frozen");
    expect(card.frozen).toBe(true);
  });

  it("maps unfreeze to active", async () => {
    const { token, card } = await actorWithCard("rain_card_2");
    card.frozen = true;
    await settingsPOST(settingsReq(token, { cardId: card.id, freeze: false }));
    expect(setCardStatus).toHaveBeenCalledWith("rain_card_2", "active");
  });

  it("does NOT report success when the issuer refuses", async () => {
    // The invariant this whole file exists for.
    setCardStatus.mockRejectedValue(new Error("issuer down"));
    const { token, card } = await actorWithCard("rain_card_3");

    const res = await settingsPOST(settingsReq(token, { cardId: card.id, freeze: true }));

    expect(res.status).toBe(502);
    // And the local state is untouched, so the UI and the network still agree.
    expect(card.frozen).toBe(false);
  });

  it("leaves the card alone entirely when the issuer refuses", async () => {
    setCardStatus.mockRejectedValue(new Error("issuer down"));
    const { token, card } = await actorWithCard("rain_card_4");
    const before = { ...card.channels };

    await settingsPOST(settingsReq(token, { cardId: card.id, freeze: true, channels: { online: false } }));

    // A partial apply would be its own kind of lie: the customer asked for two
    // changes and must not get one of them silently.
    expect(card.channels).toEqual(before);
  });

  it("skips the issuer for a card that was never issued at one", async () => {
    // Cards predating the seam have no providerCardRef. They must still be
    // freezable locally rather than 502-ing forever.
    const { token, card } = await actorWithCard(undefined);
    const res = await settingsPOST(settingsReq(token, { cardId: card.id, freeze: true }));

    expect(res.status).toBe(200);
    expect(setCardStatus).not.toHaveBeenCalled();
    expect(card.frozen).toBe(true);
  });

  it("does not call the issuer when freeze is unchanged", async () => {
    const { token, card } = await actorWithCard("rain_card_5");
    card.frozen = true;
    await settingsPOST(settingsReq(token, { cardId: card.id, freeze: true }));
    expect(setCardStatus).not.toHaveBeenCalled();
  });
});
