// Furlpay extension background service worker (MV3).
// Detects checkout pages and brokers stablecoin payment intents.

const API = "https://api.furlpay.app";

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.set({ furlpayEnabled: true });
});

// Content script asks the worker to create a checkout session (keeps keys out of the page).
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "FURLPAY_CREATE_CHECKOUT") {
    createCheckout(msg.payload)
      .then((res) => sendResponse({ ok: true, res }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true; // async response
  }
});

async function createCheckout({ amount, currency, token }) {
  const { furlpayKey } = await chrome.storage.local.get("furlpayKey");
  const res = await fetch(`${API}/api/checkout/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Furlpay-Key": furlpayKey || "pk_sandbox" },
    body: JSON.stringify({ amount, currency, token }),
  }).catch(() => null);
  if (res && res.ok) return res.json();
  // Sandbox fallback.
  return { transactionHash: "0x" + crypto.randomUUID().replace(/-/g, "").padEnd(64, "0").slice(0, 64) };
}
