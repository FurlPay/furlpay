import type { X402Detection } from "@/lib/types";

// Isolated-world companion to x402-main: receives 402 detections from the
// page, logs them to the background (DevTools inspector feed), and slides up
// the FurlPay checkout bottom-sheet. Rendered inside a closed shadow root so
// page CSS/JS cannot restyle or read it. Payment itself is completed on
// furlpay.com — this overlay is a launcher, it never handles keys or signs.

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  main() {
    let shown = false;

    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.source !== "furlpay-x402-detected" || !data.detection) return;

      const detection = data.detection as X402Detection;
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
  // x402 amounts are in the asset's atomic units; USDC has 6 decimals.
  const amountUsd = Number.isFinite(amountRaw) ? amountRaw / 1e6 : null;
  const network = typeof req?.network === "string" ? req.network : "arbitrum";

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
  const muted = document.createElement("div");
  muted.className = "muted";
  muted.textContent = `${hostnameOf(detection.url)} \u00B7 ${network} \u00B7 USDC`;
  sheet.appendChild(muted);

  // --- Amount ---
  const amountEl = document.createElement("div");
  amountEl.className = "amount";
  amountEl.textContent = amountUsd !== null ? `$${amountUsd.toFixed(2)}` : "x402";
  sheet.appendChild(amountEl);

  // --- Pay button ---
  const payBtn = document.createElement("button");
  payBtn.className = "pay";
  payBtn.type = "button";
  payBtn.textContent = "Pay with FurlPay passkey";
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

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
