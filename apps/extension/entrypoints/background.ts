import { ApiError, apiFetch, getBaseUrl, toResponse } from "@/lib/api";
import { isTrustedCheckoutUrl, type HostedCheckout, type RampQuote } from "@/lib/ramp";
import { isStepUpCode, maskEmail } from "@/lib/stepUp";
import { flush as flushAnalytics, track } from "@/lib/analytics";
import {
  NO_LINKED_WALLET_ERROR,
  payableAddressFrom,
  type LinkStatusResponse,
  type PayableAddress,
} from "@/lib/receiveAddress";
import { BADGE_BALANCE_KEY, badgeTextFor } from "@/lib/badge";
// The consent gate — the logic deciding whether a web page learns the user's
// Safe address — lives in lib/originGrants.ts so it can be tested. The key, the
// 30-day TTL and the 100-origin cap are owned there too, so there is one
// definition of each rather than a copy that can drift.
import {
  allowedOrigins as allowedOriginsOf,
  ALLOWED_ORIGINS_KEY,
  originGranted as originGrantedIn,
  rememberOrigin as rememberOriginIn,
  senderOrigin,
  type OriginStore,
} from "@/lib/originGrants";
import type {
  BarsResponse,
  BgRequest,
  BgResponse,
  EarnOverview,
  Entitlements,
  MarketDetail,
  MarketSearchResponse,
  MarketsResponse,
  TravelFlightsResponse,
  TravelHotelsResponse,
  TravelPropertyResponse,
  Overview,
  PasskeyList,
  PendingChallenge,
  RewardsSummary,
  Transaction,
  X402Detection,
} from "@/lib/types";
import { checkoutParams, sanitizeDetection } from "@/lib/x402Trust";
import { messageAllowed } from "@/lib/messageGate";

/** `chrome-extension://<id>/` (or `moz-extension://<uuid>/`). */
const extensionBase = () => browser.runtime.getURL("/");

// ---------------------------------------------------------------------------
// FurlPay service worker (MV3).
//   - Polls the balance and paints it on the toolbar badge.
//   - Polls pending 3DS2 challenges and raises native notifications with
//     Approve / Decline actions.
//
//     Approve currently deep-links to the site's biometric approval page. NOTE
//     the historical reason for that ("assertions cannot be performed from a
//     chrome-extension:// origin") is OUT OF DATE: since Chrome 122 an
//     extension may call navigator.credentials.get() with an rpID for any
//     domain in its host_permissions, and this extension declares
//     https://furlpay.com/*. In-extension approval is therefore possible once
//     the RP trusts `chrome-extension://<id>` as an origin — gated server-side
//     by FURLPAY_EXTENSION_ID (see apps/web/src/lib/webauthn.ts, which
//     documents the trust-surface tradeoff before you enable it).
//   - Routes messages from popup / side panel / content scripts.
// State is re-derived from storage + API on every wake (MV3 workers are
// ephemeral); nothing security-critical lives in memory.
// ---------------------------------------------------------------------------

const POLL_ALARM = "furlpay-poll";
const NOTIFIED_KEY = "notifiedChallenges";
const DEPOSITS_KEY = "notifiedDeposits";
// Origins the user has explicitly allowed to see their smart-account address
// (origin → grantedAt epoch ms). A dapp NOT in this map gets a consent prompt
// before WALLET_CONNECT resolves — without it, any open website could silently
// learn the user's Safe address (a wallet-fingerprinting / deanonymization
// vector), which is why every real wallet gates connect behind a click.
/** How long a granted origin stays remembered. A site the user connected to
 *  once is not a site they trust forever: domains change hands and dapps get
 *  compromised, and a grant with no expiry means yesterday's approval still
 *  hands out the Safe address today. Re-consent is one click. */

/** Pending consent prompts, keyed by request id. MV3 workers are ephemeral,
 *  but the open sendResponse channel (`return true`) keeps this worker alive
 *  while the user decides; an unresolved prompt simply denies on timeout at
 *  the provider layer (60s). */
const pendingConnects = new Map<
  string,
  { origin: string; windowId?: number; respond: (res: BgResponse<{ accounts: string[] }>) => void }
>();

// browser.action is MV3; Firefox MV2 builds expose browserAction instead.
const action = () => browser.action ?? (browser as any).browserAction;

/** Is the balance shown on the badge? Mirrors the `prefBadgeBalance`
 *  StoredToggle in the popup's Settings tab; absent means on. */
async function showBadgeBalance(): Promise<boolean> {
  const stored = await browser.storage.local.get(BADGE_BALANCE_KEY);
  const pref = stored[BADGE_BALANCE_KEY];
  return typeof pref === "boolean" ? pref : true; // default on
}

/** Repaint the badge from the last-known overview — used when the preference
 *  flips, so masking takes effect immediately instead of at the next poll. */
async function repaintBadge(): Promise<void> {
  const { cachedOverview } = await browser.storage.session
    .get("cachedOverview")
    .catch(() => ({ cachedOverview: undefined }));
  const overview = cachedOverview as Overview | undefined;
  if (!overview) return; // signed out — the badge is already cleared
  await action().setBadgeText({ text: badgeTextFor(overview.netWorth, await showBadgeBalance()) });
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener((details) => {
    browser.alarms.create(POLL_ALARM, { periodInMinutes: 1 });
    void poll();
    if (details?.reason === "install") void track("extension_installed");
  });
  browser.runtime.onStartup.addListener(() => {
    browser.alarms.create(POLL_ALARM, { periodInMinutes: 1 });
    void poll();
    void track("extension_started");
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name !== POLL_ALARM) return;
    void poll();
    // Analytics rides the existing alarm: no extra wake-ups, and a failure
    // here never touches polling (flush swallows nothing it should not, but
    // nothing it does can throw into the extension).
    void flushAnalytics().catch(() => undefined);
  });

  // Flipping the badge preference must take effect now, not up to a minute
  // later — someone toggling it is usually about to start sharing their screen.
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && BADGE_BALANCE_KEY in changes) void repaintBadge();
  });

  // Notification action buttons: [Approve on furlpay.com] [Decline].
  // Firefox has no onButtonClicked — guarded; plain clicks still work there.
  browser.notifications.onButtonClicked?.addListener((notificationId, buttonIndex) => {
    if (!notificationId.startsWith("chal_")) return;
    if (buttonIndex === 0) void openApprovePage(notificationId);
    else void declineChallenge(notificationId);
    browser.notifications.clear(notificationId);
  });
  browser.notifications.onClicked.addListener((notificationId) => {
    if (notificationId.startsWith("chal_")) void openApprovePage(notificationId);
    if (notificationId.startsWith("dep_")) {
      void getBaseUrl().then((base) => browser.tabs.create({ url: `${base}/dashboard` }));
    }
    browser.notifications.clear(notificationId);
  });

  // Closing the consent prompt without answering is a denial — the dapp's
  // request must never hang until the provider-side timeout if we can help it.
  browser.windows.onRemoved.addListener((windowId) => {
    const owner = [...pendingConnects.values()].find((p) => p.windowId === windowId);
    if (!owner) return;
    // Settle every queued request for that origin (duplicates share the prompt).
    for (const [rid, p] of [...pendingConnects]) {
      if (p.origin !== owner.origin) continue;
      pendingConnects.delete(rid);
      p.respond({ ok: false, error: "Connection request was rejected." });
    }
  });

  browser.runtime.onMessage.addListener((message: BgRequest, sender, sendResponse) => {
    // Our own surfaces only, and content scripts only for their three types
    // (lib/messageGate.ts — a content script shares this extension's id).
    if (!messageAllowed(message?.type, sender, browser.runtime.id, extensionBase())) {
      if (sender.id === browser.runtime.id) sendResponse({ ok: false, error: "Not permitted from this context." });
      return;
    }

    switch (message.type) {
      case "GET_RECEIVE_ADDRESS":
        void toResponse(fetchPayableAddress()).then(sendResponse);
        return true;
      case "GET_OVERVIEW":
        void toResponse(apiFetch<Overview>("/api/overview")).then(sendResponse);
        return true;
      case "GET_CHALLENGES":
        void toResponse(apiFetch<{ challenges: PendingChallenge[] }>("/api/cards/challenges")).then(sendResponse);
        return true;
      case "DECLINE_CHALLENGE":
        void toResponse(
          apiFetch("/api/cards/challenges/verify", {
            method: "POST",
            body: JSON.stringify({ challengeId: message.challengeId, decision: "declined" }),
          })
        ).then(sendResponse);
        return true;
      case "OPEN_APPROVE":
        void openApprovePage(message.challengeId).then(() => sendResponse({ ok: true, data: null }));
        return true;
      case "GET_REWARDS":
        void toResponse(apiFetch<RewardsSummary>("/api/rewards")).then(sendResponse);
        return true;
      case "GET_TRANSACTIONS":
        void toResponse(apiFetch<{ transactions: Transaction[] }>("/api/transactions")).then(sendResponse);
        return true;
      case "GET_BARS":
        void toResponse(
          apiFetch<BarsResponse>(
            `/api/markets/bars?symbol=${encodeURIComponent(message.symbol)}&tf=${encodeURIComponent(message.tf)}`
          )
        ).then(sendResponse);
        return true;
      case "GET_ENTITLEMENTS":
        void toResponse(apiFetch<Entitlements>("/api/user/entitlements")).then(sendResponse);
        return true;
      case "UPGRADE_PLAN":
        // Stripe Checkout (or sandbox upgrade) happens on the site, never in
        // the extension — open the returned URL in a tab.
        void toResponse(
          apiFetch<{ url: string; sandbox: boolean }>("/api/billing/checkout", {
            method: "POST",
            body: JSON.stringify({ plan: message.plan }),
          }).then(async (r) => {
            if (r.url) await browser.tabs.create({ url: r.url });
            return r;
          })
        ).then(sendResponse);
        return true;
      case "RAMP_QUOTE":
        void toResponse(
          apiFetch<RampQuote>("/api/onramp/quote", {
            method: "POST",
            body: JSON.stringify({
              fiatAmount: message.fiatAmount,
              fiatCurrency: message.fiatCurrency,
              token: "USDC",
              chain: message.chain,
              paymentMethod: "card",
            }),
          })
        ).then(sendResponse);
        return true;
      case "RAMP_CHECKOUT":
        void toResponse(
          (message.direction === "buy"
            ? apiFetch<{ hosted: HostedCheckout | null; flags?: string[] }>("/api/onramp/session", {
                method: "POST",
                body: JSON.stringify({
                  fiatAmount: message.amount,
                  fiatCurrency: message.fiatCurrency,
                  token: "USDC",
                  chain: message.chain,
                  paymentMethod: "card",
                  destinationAddress: message.address,
                }),
              })
            : apiFetch<{ hosted: HostedCheckout | null; flags?: string[] }>("/api/offramp/session", {
                method: "POST",
                body: JSON.stringify({ address: message.address, chain: message.chain, token: "USDC", cryptoAmount: message.amount }),
              })
          ).then(async (r) => {
            if (!r.hosted) throw new Error("not_available");
            // Never open a tab on a URL that is not Coinbase's checkout (lib/ramp.ts).
            if (!isTrustedCheckoutUrl(r.hosted.url)) throw new Error("untrusted_checkout_url");
            await browser.tabs.create({ url: r.hosted.url });
            return { opened: true as const, flags: r.flags ?? [] };
          })
        ).then(sendResponse);
        return true;
      case "STEP_UP_SEND":
        void toResponse(
          apiFetch<{ email?: string | null }>("/api/profile").then(async (p) => {
            if (!p.email) throw new Error("no_email");
            await apiFetch("/api/auth/otp/start", { method: "POST", body: JSON.stringify({ to: p.email, channel: "email" }) });
            return { sentTo: maskEmail(p.email) };
          })
        ).then(sendResponse);
        return true;
      case "STEP_UP_VERIFY":
        // A successful check issues a fresh session cookie for furlpay.com with
        // the step-up recorded on it (apps/web lib/stepup.ts). The email is
        // re-read from the profile, never taken from the popup.
        void toResponse(
          apiFetch<{ email?: string | null }>("/api/profile").then(async (p) => {
            if (!p.email) throw new Error("no_email");
            if (!isStepUpCode(message.code)) throw new Error("bad_code");
            await apiFetch("/api/auth/otp/check", {
              method: "POST",
              body: JSON.stringify({ to: p.email, code: message.code, channel: "email", login: true }),
            });
            return { verified: true as const };
          })
        ).then(sendResponse);
        return true;
      case "GET_EARN":
        void toResponse(apiFetch<EarnOverview>("/api/earn")).then(sendResponse);
        return true;
      case "GET_MARKETS": {
        // /api/markets is public (no session required), so the markets view
        // works signed out too. Sorted by move so the first screen reads as
        // today's movers rather than alphabetical catalog order.
        const qs = new URLSearchParams({ sort: "-changePct" });
        if (message.kind) qs.set("kind", message.kind);
        if (message.q) qs.set("q", message.q);
        if (message.limit) qs.set("limit", String(message.limit));
        void toResponse(apiFetch<MarketsResponse>(`/api/markets?${qs}`)).then(sendResponse);
        return true;
      }
      case "SEARCH_MARKETS": {
        // The full ~13k tradable universe. Replaces the old /api/markets call,
        // which could only ever return the 391 hand-curated symbols — the
        // reason most real listings were unfindable in the extension.
        const qs = new URLSearchParams();
        if (message.q) qs.set("q", message.q);
        if (message.kind) qs.set("kind", message.kind);
        qs.set("limit", String(message.limit ?? 30));
        void toResponse(apiFetch<MarketSearchResponse>(`/api/markets/search?${qs}`)).then(sendResponse);
        return true;
      }
      case "GET_MARKET_DETAIL":
        void toResponse(
          apiFetch<MarketDetail>(`/api/markets/${encodeURIComponent(message.symbol)}`)
        ).then(sendResponse);
        return true;
      case "GET_TRAVEL_HOTELS":
        void toResponse(
          apiFetch<TravelHotelsResponse>(`/api/travel/hotels?city=${encodeURIComponent(message.city)}`)
        ).then(sendResponse);
        return true;
      case "SEARCH_FLIGHTS":
        void toResponse(
          apiFetch<TravelFlightsResponse>("/api/travel/search", {
            method: "POST",
            body: JSON.stringify({
              type: "flights",
              from: message.from,
              to: message.to,
              date: message.date,
              cabin: message.cabin ?? "economy",
            }),
          })
        ).then(sendResponse);
        return true;
      case "GET_TRAVEL_PROPERTY":
        void toResponse(
          apiFetch<TravelPropertyResponse>(
            `/api/travel/property/${encodeURIComponent(message.id)}?city=${encodeURIComponent(message.city)}`
          )
        ).then(sendResponse);
        return true;
      case "LOGOUT":
        // Grants, display snapshots, and notification de-duplication belong to
        // the signed-in account. Leaving any of them behind lets the next
        // account on this browser inherit a dapp's wallet-connect consent.
        void toResponse(
          apiFetch("/api/auth/logout", { method: "POST" }).then(async (result) => {
            await clearAccountState();
            return result;
          })
        ).then(sendResponse);
        return true;
      case "GET_PASSKEYS":
        void toResponse(apiFetch<PasskeyList>("/api/auth/passkey/credentials")).then(sendResponse);
        return true;
      case "REVOKE_PASSKEY":
        void toResponse(
          apiFetch("/api/auth/passkey/credentials", {
            method: "DELETE",
            body: JSON.stringify({ credentialId: message.credentialId }),
          })
        ).then(sendResponse);
        return true;
      case "TRAVEL_SEARCH":
        void track("travel_search", { source: "extension" });
        void toResponse(
          apiFetch("/api/travel/search", { method: "POST", body: JSON.stringify(message.payload) })
        ).then(sendResponse);
        return true;
      case "GET_SESSION_STATE":
        void toResponse(sessionState()).then(sendResponse);
        return true;
      case "OPEN_LOGIN":
        void getBaseUrl().then((base) => browser.tabs.create({ url: `${base}/login` }));
        sendResponse({ ok: true, data: null });
        return false;
      case "WALLET_CONNECT": {
        // EIP-6963 connect. The page origin comes from `sender` (set by the
        // browser for the relaying content script — the page cannot forge it).
        // Known origin → resolve; unknown → consent prompt first.
        const origin = senderOrigin(sender);
        if (!origin) {
          sendResponse({ ok: false, error: "Connection origin could not be determined." });
          return false;
        }
        void connectWithConsent(origin, sendResponse);
        return true;
      }
      case "WALLET_CONNECT_DECISION": {
        // From the connect-prompt page (extension origin — enforced by the
        // sender.id gate above). Resolves the pending dapp request.
        void resolveConnectDecision(message.requestId, message.allow);
        sendResponse({ ok: true, data: null });
        return false;
      }
      case "X402_DETECTED": {
        // The isolated-world relay is fed by window.postMessage, so validate
        // again at the worker boundary before storing page-controlled data.
        const detected = sanitizeDetection(message.detection);
        if (!detected) {
          sendResponse({ ok: false, error: "Invalid x402 detection." });
          return false;
        }
        void onX402Detected(detected);
        sendResponse({ ok: true, data: null });
        return false;
      }
      case "OPEN_X402_CHECKOUT":
        // `sender` carries the real page origin — the only part of this flow the
        // page cannot forge. See openX402Checkout.
        void openX402Checkout(message.detection, sender);
        sendResponse({ ok: true, data: null });
        return false;
    }
  });
});

// --- wallet connect consent ----------------------------------------------

// The consent gate itself lives in lib/originGrants.ts so it can be tested:
// these are the functions that decide whether an arbitrary web page learns the
// user's Safe address, and as private functions here they had no coverage. The
// thin wrappers below bind them to browser.storage.local.
//
// `store` is the injected slice of extension storage. browser.storage.local's
// get/set already match the OriginStore shape, so this is a direct pass-through
// rather than an adapter.
const store: OriginStore = {
  get: (key) => browser.storage.local.get(key) as Promise<Record<string, unknown>>,
  set: (items) => browser.storage.local.set(items),
};

const allowedOrigins = () => allowedOriginsOf(store);
const originGranted = (origin: string) => originGrantedIn(store, origin);
const rememberOrigin = (origin: string) => rememberOriginIn(store, origin);

/** The user's VERIFIED linked wallet (GET /api/wallet/link), or the reason
 *  there is none. Never falls back to anything address-shaped: the account's
 *  placeholder address has no key (lib/receiveAddress.ts). Throws ApiError on
 *  transport/auth failure so callers can tell "signed out" from "no wallet". */
async function fetchPayableAddress(): Promise<PayableAddress> {
  try {
    return payableAddressFrom(await apiFetch<LinkStatusResponse>("/api/wallet/link"));
  } catch (e) {
    // 404 not_enabled: linking is switched off on this deployment.
    if (e instanceof ApiError && e.status === 404) return { ok: false, reason: "linking_disabled" };
    throw e;
  }
}

/** Resolve the account for an approved connect: the verified linked wallet
 *  only. No link → NO_LINKED_WALLET (the page provider maps it to EIP-1193
 *  4100) and the app's wallet setup is the remedy. Signed out → open login so
 *  the user can authenticate, and let the dapp's request fail cleanly. */
async function resolveAccounts(): Promise<BgResponse<{ accounts: string[] }>> {
  try {
    const payable = await fetchPayableAddress();
    if (!payable.ok) return { ok: false, error: NO_LINKED_WALLET_ERROR };
    return { ok: true, data: { accounts: [payable.address] } };
  } catch (e) {
    if (e instanceof ApiError && e.status === 401) {
      const base = await getBaseUrl();
      void browser.tabs.create({ url: `${base}/login` });
    }
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

async function connectWithConsent(
  origin: string,
  respond: (res: BgResponse<{ accounts: string[] }>) => void
): Promise<void> {
  if (await originGranted(origin)) {
    respond(await resolveAccounts());
    return;
  }

  // Origin not yet approved — one prompt window per origin; a second connect
  // from the same origin focuses the existing prompt and shares its verdict.
  for (const [, p] of pendingConnects) {
    if (p.origin === origin) {
      if (p.windowId !== undefined) void browser.windows.update(p.windowId, { focused: true });
      const rid = crypto.randomUUID();
      pendingConnects.set(rid, { origin, respond });
      return;
    }
  }

  const requestId = crypto.randomUUID();
  pendingConnects.set(requestId, { origin, respond });
  try {
    const url = browser.runtime.getURL(
      `/connect-prompt.html?rid=${encodeURIComponent(requestId)}&origin=${encodeURIComponent(origin)}`
    );
    const win = await browser.windows.create({ url, type: "popup", width: 380, height: 460 });
    const entry = pendingConnects.get(requestId);
    if (entry && win?.id !== undefined) entry.windowId = win.id;
  } catch (e) {
    pendingConnects.delete(requestId);
    respond({ ok: false, error: `Could not open the connection prompt: ${String(e)}` });
  }
}

async function resolveConnectDecision(requestId: string, allow: boolean): Promise<void> {
  const entry = pendingConnects.get(requestId);
  if (!entry) return;
  // Settle every pending request for this origin with the same verdict.
  const settled = [...pendingConnects.entries()].filter(([, p]) => p.origin === entry.origin);
  for (const [rid] of settled) pendingConnects.delete(rid);

  if (!allow) {
    for (const [, p] of settled) p.respond({ ok: false, error: "Connection request was rejected." });
    return;
  }
  // The decision, never the site: the dapp origin is not sent anywhere.
  void track("extension_connected", { source: "dapp_consent" });
  await rememberOrigin(entry.origin);
  const res = await resolveAccounts();
  for (const [, p] of settled) p.respond(res);
}

async function sessionState(): Promise<{ authenticated: boolean; name?: string; baseUrl: string }> {
  const baseUrl = await getBaseUrl();
  try {
    const overview = await apiFetch<Overview>("/api/overview");
    return { authenticated: true, name: overview.user.name, baseUrl };
  } catch {
    return { authenticated: false, baseUrl };
  }
}

async function clearAccountState(): Promise<void> {
  for (const [, pending] of pendingConnects) {
    pending.respond({ ok: false, error: "Signed out before the connection request was completed." });
  }
  pendingConnects.clear();
  await Promise.all([
    browser.storage.session.remove(["cachedOverview", "cachedChallenges"]),
    browser.storage.local.remove([ALLOWED_ORIGINS_KEY, NOTIFIED_KEY, DEPOSITS_KEY]),
    action().setBadgeText({ text: "" }),
  ]).catch(() => undefined);
}

/** Refresh badge (net worth across all assets) and surface any new 3DS challenges. */
async function poll(): Promise<void> {
  try {
    const overview = await apiFetch<Overview>("/api/overview");
    await action().setBadgeBackgroundColor({ color: "#00e599" });
    await action().setBadgeText({ text: badgeTextFor(overview.netWorth, await showBadgeBalance()) });
    // Last-known-good snapshot for the popup's instant paint (G5). Session
    // storage: display-only data, gone when the browser closes — never a
    // place secrets could accumulate.
    await browser.storage.session.set({ cachedOverview: overview }).catch(() => undefined);
  } catch {
    await action().setBadgeText({ text: "" });
    await browser.storage.session.remove(["cachedOverview", "cachedChallenges"]).catch(() => undefined);
    return; // no session — challenge polling would 401 too
  }

  // On-chain deposit tracking: notify on new detections and on credit, across
  // every supported chain (state machine: pending → processing → success).
  try {
    const { deposits } = await apiFetch<{
      deposits: { txHash: string; status: string; amount: number; token: string; chain: string }[];
    }>("/api/deposits");
    const stored = await browser.storage.local.get(DEPOSITS_KEY);
    const seen = (stored[DEPOSITS_KEY] ?? {}) as Record<string, string>;

    for (const d of deposits) {
      const notable = d.status === "pending" || d.status === "success";
      if (!notable || seen[d.txHash] === d.status) continue;
      seen[d.txHash] = d.status;
      const chainLabel = d.chain === "bsc" ? "BSC" : d.chain.charAt(0).toUpperCase() + d.chain.slice(1);
      await browser.notifications
        .create(`dep_${d.txHash}`, {
          type: "basic",
          iconUrl: browser.runtime.getURL("/icon128.png"),
          title: d.status === "success" ? "Deposit credited" : "Deposit detected",
          message:
            d.status === "success"
              ? `+${d.amount} ${d.token} on ${chainLabel} added to your balance.`
              : `+${d.amount} ${d.token} incoming on ${chainLabel} — confirming…`,
        })
        .catch(() => undefined);
    }
    // Bound storage: keep the most recent 50 tx states.
    const entries = Object.entries(seen).slice(-50);
    await browser.storage.local.set({ [DEPOSITS_KEY]: Object.fromEntries(entries) });
  } catch {
    /* deposits endpoint unavailable — badge/challenges still work */
  }

  try {
    const { challenges } = await apiFetch<{ challenges: PendingChallenge[] }>("/api/cards/challenges");
    await browser.storage.session.set({ cachedChallenges: challenges }).catch(() => undefined);
    const stored = await browser.storage.local.get(NOTIFIED_KEY);
    const notified: string[] = Array.isArray(stored[NOTIFIED_KEY]) ? stored[NOTIFIED_KEY] : [];

    for (const challenge of challenges) {
      if (notified.includes(challenge.id)) continue;
      const base = {
        type: "basic" as const,
        iconUrl: browser.runtime.getURL("/icon128.png"),
        title: "Approve card transaction",
        message: `Approve payment of $${challenge.amountUsd.toFixed(2)} to ${challenge.merchant.name}?`,
      };
      try {
        // Chrome: action buttons + sticky. Firefox rejects both options.
        await browser.notifications.create(challenge.id, {
          ...base,
          buttons: [{ title: "Approve with biometric" }, { title: "Decline" }],
          priority: 2,
          requireInteraction: true,
        } as any);
      } catch {
        await browser.notifications.create(challenge.id, base);
      }
    }
    const currentIds = challenges.map((c) => c.id);
    await browser.storage.local.set({
      // Keep only ids that are still pending, plus newly notified ones.
      // Bound storage: keep the most recent 50 challenge ids.
      [NOTIFIED_KEY]: Array.from(new Set([...notified.filter((id) => currentIds.includes(id)), ...currentIds])).slice(-50),
    });
  } catch {
    /* challenge polling is best-effort */
  }
}

async function openApprovePage(challengeId?: string): Promise<void> {
  const base = await getBaseUrl();
  const url = challengeId ? `${base}/cards/approve?challenge=${challengeId}` : `${base}/cards/approve`;
  await browser.tabs.create({ url });
}

async function declineChallenge(challengeId: string): Promise<void> {
  void track("transaction_rejected", { source: "card_challenge" });
  try {
    await apiFetch("/api/cards/challenges/verify", {
      method: "POST",
      body: JSON.stringify({ challengeId, decision: "declined" }),
    });
    await browser.notifications.create(`declined-${challengeId}`, {
      type: "basic",
      iconUrl: browser.runtime.getURL("/icon128.png"),
      title: "Transaction declined",
      message: "No fee charged — declines are always free on FurlPay.",
    });
  } catch (e) {
    await browser.notifications.create(`declinefail-${challengeId}`, {
      type: "basic",
      iconUrl: browser.runtime.getURL("/icon128.png"),
      title: "Could not decline",
      message: e instanceof Error ? e.message : "Open FurlPay to resolve this transaction.",
    });
  }
}

// --- x402 ---------------------------------------------------------------

async function onX402Detected(detection: X402Detection): Promise<void> {
  // Rolling log for the DevTools inspector and popup indicator, deduped by
  // resource URL (a page retrying a 402 shouldn't flood the log).
  const { x402Log } = await browser.storage.local.get("x402Log");
  const log: X402Detection[] = Array.isArray(x402Log) ? x402Log : [];
  const deduped = [detection, ...log.filter((d) => d.url !== detection.url)];
  await browser.storage.local.set({ x402Log: deduped.slice(0, 50) });
}

/** Opens the furlpay.com checkout for a detected 402.
 *
 *  Nothing inside `detection` is authenticated. It reaches the isolated world
 *  through window.postMessage from the MAIN world, which shares the page's
 *  window — a page script can post a byte-identical message, and
 *  `event.source === window` cannot tell the two apart. Treat every field as a
 *  claim by the site.
 *
 *  So `payTo` and `maxAmountRequired` are deliberately NOT forwarded. Carrying
 *  them meant any site could pop a FurlPay prompt naming an attacker's
 *  recipient. Only the resource URL goes through, and furlpay.com re-fetches
 *  the 402 itself to learn the real recipient, amount and network.
 *
 *  `sender.origin` is the one value the page cannot forge — the browser sets it
 *  on the relaying content script — so it is passed alongside, letting the
 *  checkout show which site actually asked and cross-check the resource. */
async function openX402Checkout(
  detection: X402Detection,
  sender: { origin?: string; url?: string }
): Promise<void> {
  const safe = sanitizeDetection(detection);
  // Not a web resource we could re-fetch and verify — there is nothing to check out.
  if (!safe) return;

  const base = await getBaseUrl();
  const params = checkoutParams(safe, senderOrigin(sender));

  // Settlement + passkey signing happen on furlpay.com (the rpID origin), which
  // verifies the 402 against `resource` before it displays a recipient or amount.
  // /pay/x402 re-reads the 402 server-side and shows what the RESOURCE asks for;
  // the link carries only the resource URL and the browser-verified origin.
  await browser.tabs.create({ url: `${base}/pay/x402?${params.toString()}` });
}
