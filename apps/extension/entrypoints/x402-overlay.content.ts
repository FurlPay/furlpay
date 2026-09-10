import type { X402Detection } from "@/lib/types";
import { sanitizeDetection } from "@/lib/x402Trust";

// Isolated-world companion to x402-main: receives 402 detections from the
// page, logs them to the background (DevTools inspector feed), and slides up
// the FurlPay checkout bottom-sheet. Rendered inside a closed shadow root so
// page CSS/JS cannot restyle or read it. Payment itself is completed on
// furlpay.com — this overlay is a launcher, it never handles keys or signs.

export default defineContentScript({
  // Web pages only — http(s), never file:///ftp://. Narrowest scope per
  // CWS Limited Use (Aug 2026).
  matches: ["https://*/*", "http://*/*"],
  runAt: "document_start",
  main() {
    let shown = false;

    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== "furlpay-x402-detected" || !data.detection) return;

      // `event.source === window` does NOT prove this came from x402-main: the
      // MAIN world shares the page's window, so a page script can post the same
      // message. Nothing here is authenticated — the detection is a claim made
      // by this site, and is rendered and forwarded as such. The recipient and
      // amount are established by furlpay.com re-fetching the resource, never
      // by these values. See openX402Checkout in background.ts.
      const detection = sanitizeDetection(data.detection);
      if (!detection) return;

      // Swallow "extension context invalidated" (page outliving a reload).
      browser.runtime.sendMessage({ type: "X402_DETECTED", detection }).catch(() => {});
      if (!shown) {
        shown = true;
        renderSheet(detection, () => (shown = false));
      }
    });
  },
});

function renderSheet(detection: X402Detection, onClose: () => void) {
  const req = detection.requirements[0] as Record<string, unknown> | undefined;
  const amountRaw = req?.maxAmountRequired ? Number(req.maxAmountRequired) : NaN;
  // x402 amounts are in the asset's atomic units; USDC has 6 decimals. Claimed
  // by the page, so it is labelled as such below and never sent to checkout.
  const amountUsd = Number.isFinite(amountRaw) && amountRaw >= 0 ? amountRaw / 1e6 : null;

  const host = document.createElement("div");
  host.style.cssText = "all: initial; position: fixed; z-index: 2147483647; inset: auto 0 0 0;";
  const shadow = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = `
    .sheet { font-family: Inter, -apple-system, "Segoe UI", sans-serif; background: #111113; color: #f3f4f6;
      border: 1px solid rgba(255,255,255,0.08); border-bottom: none; border-radius: 16px 16px 0 0;
      max-width: 420px; margin: 0 auto; padding: 20px; box-shadow: 0 -12px 40px rgba(0,0,0,0.5);
      transform: translateY(100%); transition: transform .35s cubic-bezier(.22,1,.36,1); }
    .sheet.open { transform: translateY(0); }
    .row { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
    .title { font-weight: 700; font-size: 15px; }
    .muted { color: #9ca3af; font-size: 12px; }
    .amount { font-family: "JetBrains Mono", monospace; font-size: 26px; font-weight: 700;
      background: linear-gradient(135deg,#00e599,#00b87a); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .pay { width: 100%; margin-top: 14px; background: linear-gradient(135deg,#00e599,#00b87a); color: #fff;
      border: none; border-radius: 12px; padding: 13px; font-weight: 600; font-size: 14px; cursor: pointer; }
    .close { background: none; border: none; color: #6b7280; cursor: pointer; font-size: 12px; }
  `;

  const sheet = document.createElement("div");
  sheet.className = "sheet";

  // --- Title row (safe DOM API — no innerHTML) ---
  const row = document.createElement("div");
  row.className = "row";

  const title = document.createElement("span");
  title.className = "title";
  title.textContent = "Payment required";
  row.appendChild(title);

  const closeBtn = document.createElement("button");
  closeBtn.className = "close";
  closeBtn.type = "button";
  closeBtn.textContent = "Dismiss";
  row.appendChild(closeBtn);

  sheet.appendChild(row);

  // --- Muted context line ---
  // The site being shown is THIS page, read from location \u2014 not the hostname of
  // the detection's URL. A page can claim any resource URL, so rendering that
  // would let evil.com display a trusted-looking name above the amount.
  const muted = document.createElement("div");
  muted.className = "muted";
  muted.textContent = `Requested by ${location.hostname}`;
  sheet.appendChild(muted);

  // --- Amount ---
  const amountEl = document.createElement("div");
  amountEl.className = "amount";
  amountEl.textContent = amountUsd !== null ? `$${amountUsd.toFixed(2)}` : "x402";
  sheet.appendChild(amountEl);

  // --- Unverified-amount qualifier ---
  // The amount above is whatever the page put in the 402 body. FurlPay confirms
  // the real recipient and amount by re-fetching the resource, so the sheet must
  // not present these numbers as settled.
  const claimed = document.createElement("div");
  claimed.className = "muted";
  claimed.textContent = "Amount claimed by this site \u00B7 verified on FurlPay before you pay";
  sheet.appendChild(claimed);

  // --- Pay button ---
  const payBtn = document.createElement("button");
  payBtn.className = "pay";
  payBtn.type = "button";
  payBtn.textContent = "Review on FurlPay";
  sheet.appendChild(payBtn);

  const close = () => {
    sheet.classList.remove("open");
    setTimeout(() => host.remove(), 350);
    onClose();
  };
  closeBtn.addEventListener("click", close);
  payBtn.addEventListener("click", () => {
    browser.runtime.sendMessage({ type: "OPEN_X402_CHECKOUT", detection }).catch(() => {});
    close();
  });

  shadow.append(style, sheet);
  (document.body ?? document.documentElement).appendChild(host);
  requestAnimationFrame(() => sheet.classList.add("open"));
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
