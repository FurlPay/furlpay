import { apiFetch, getBaseUrl, toResponse } from "@/lib/api";
import type {
  BarsResponse,
  BgRequest,
  EarnOverview,
  Entitlements,
  Overview,
  PasskeyList,
  PendingChallenge,
  RewardsSummary,
  Transaction,
  X402Detection,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// FurlPay service worker (MV3).
//   - Polls the balance and paints it on the toolbar badge.
//   - Polls pending 3DS2 challenges and raises native notifications with
//     Approve / Decline actions (Approve deep-links to the site's biometric
//     approval page — WebAuthn assertions for the furlpay.com rpID cannot be
//     performed from a chrome-extension:// origin, so approval always happens
//     on the origin the passkey is bound to; that is what makes it
//     phishing-proof).
//   - Routes messages from popup / side panel / content scripts.
// State is re-derived from storage + API on every wake (MV3 workers are
// ephemeral); nothing security-critical lives in memory.
// ---------------------------------------------------------------------------

const POLL_ALARM = "furlpay-poll";
const NOTIFIED_KEY = "notifiedChallenges";

// browser.action is MV3; Firefox MV2 builds expose browserAction instead.
const action = () => browser.action ?? (browser as any).browserAction;

/** Chrome truncates badge text past 4 characters — format to always fit. */
export function badgeLabel(usd: number): string {
  if (usd >= 100_000) return `${Math.round(usd / 1000)}k`; // "250k"
  if (usd >= 10_000) return `${(usd / 1000).toFixed(0)}k`; // "42k"
  if (usd >= 1_000) return `${(usd / 1000).toFixed(1)}k`; // "4.2k"
  return `$${Math.round(usd)}`; // "$980"
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => {
    browser.alarms.create(POLL_ALARM, { periodInMinutes: 1 });
    void poll();
  });
  browser.runtime.onStartup.addListener(() => {
    browser.alarms.create(POLL_ALARM, { periodInMinutes: 1 });
    void poll();
  });

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === POLL_ALARM) void poll();
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
    browser.notifications.clear(notificationId);
  });

  browser.runtime.onMessage.addListener((message: BgRequest, sender, sendResponse) => {
    // Only trust our own extension surfaces (popup/sidepanel/content scripts).
    if (sender.id !== browser.runtime.id) return;

    switch (message.type) {
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
      case "GET_EARN":
        void toResponse(apiFetch<EarnOverview>("/api/earn")).then(sendResponse);
        return true;
      case "LOGOUT":
        void toResponse(apiFetch("/api/auth/logout", { method: "POST" })).then(sendResponse);
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
      case "X402_DETECTED":
        void onX402Detected(message.detection);
        sendResponse({ ok: true, data: null });
        return false;
      case "OPEN_X402_CHECKOUT":
        void openX402Checkout(message.detection);
        sendResponse({ ok: true, data: null });
        return false;
    }
  });
});

async function sessionState(): Promise<{ authenticated: boolean; name?: string; baseUrl: string }> {
  const baseUrl = await getBaseUrl();
  try {
    const overview = await apiFetch<Overview>("/api/overview");
    return { authenticated: true, name: overview.user.name, baseUrl };
  } catch {
    return { authenticated: false, baseUrl };
  }
}

/** Refresh badge (USDC balance) and surface any new 3DS challenges. */
async function poll(): Promise<void> {
  try {
    const overview = await apiFetch<Overview>("/api/overview");
    const usdc = overview.tokenBalances
      .filter((b) => b.token.toUpperCase().startsWith("USD"))
      .reduce((sum, b) => sum + b.usdValue, 0);
    await action().setBadgeBackgroundColor({ color: "#00e599" });
    await action().setBadgeText({ text: badgeLabel(usdc) });
  } catch {
    await action().setBadgeText({ text: "" });
    return; // no session — challenge polling would 401 too
  }

  try {
    const { challenges } = await apiFetch<{ challenges: PendingChallenge[] }>("/api/cards/challenges");
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
      [NOTIFIED_KEY]: Array.from(new Set([...notified.filter((id) => currentIds.includes(id)), ...currentIds])),
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

async function openX402Checkout(detection: X402Detection): Promise<void> {
  const base = await getBaseUrl();
  const req = detection.requirements[0] ?? {};
  const params = new URLSearchParams({
    resource: detection.url,
    ...(req.payTo ? { payTo: String(req.payTo) } : {}),
    ...(req.maxAmountRequired ? { amount: String(req.maxAmountRequired) } : {}),
    ...(req.network ? { network: String(req.network) } : {}),
  });
  // Settlement + passkey signing happen on furlpay.com (the rpID origin).
  await browser.tabs.create({ url: `${base}/developer?x402=${encodeURIComponent(params.toString())}` });
}
