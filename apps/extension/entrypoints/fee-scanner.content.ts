// Merchant fee comparison scanner — the "Honey for payment fees".
// On checkout-looking pages, shows a small dismissible pill comparing typical
// card processing cost (~2.9% + $0.30) against FurlPay's 0.5% flat.
// Heuristics only, read-only, shadow-DOM isolated; never touches page forms.
// Money math + total-selection logic live in @/lib/fees (unit-tested).

import { AmountCandidate, CHECKOUT_HINTS, compareFees, extractAmounts, pickTotal } from "@/lib/fees";

export default defineContentScript({
  // http(s) only — never chrome://, chrome-extension://, about:, file://
  // (G4: CWS reviewers flag <all_urls> on scanners; web pages are the only
  // place a checkout total can exist anyway).
  matches: ["https://*/*", "http://*/*"],
  runAt: "document_idle",
  main() {
    if (!CHECKOUT_HINTS.test(location.href) && !CHECKOUT_HINTS.test(document.title)) return;
    // Never show on FurlPay itself.
    if (/(^|\.)furlpay\.com$/.test(location.hostname) || location.hostname === "localhost") return;

    browser.storage.local.get("feeScannerDismissed").then(({ feeScannerDismissed }) => {
      const dismissed = (feeScannerDismissed ?? {}) as Record<string, number>;
      // Respect a per-site dismissal for 7 days.
      if (Date.now() - (dismissed[location.hostname] ?? 0) < 7 * 86400_000) return;

      const total = detectTotal();
      renderPill(total);
    });
  },
});

/** Best-effort order total: scan for currency amounts near "total" labels,
 *  falling back to the largest dollar amount on the page. */
function detectTotal(): number | null {
  if (!document.body) return null;
  const candidates: AmountCandidate[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  let scanned = 0;
  while ((node = walker.nextNode()) && scanned < 4000) {
    scanned += 1;
    const text = node.textContent ?? "";
    if (text.length > 200) continue;
    candidates.push(...extractAmounts(text, node.parentElement?.textContent ?? ""));
  }
  return pickTotal(candidates);
}

function renderPill(total: number | null) {
  const fees = total !== null ? compareFees(total) : null;
  const saving = fees?.saving ?? null;

  const host = document.createElement("div");
  host.style.cssText = "all: initial; position: fixed; right: 16px; bottom: 16px; z-index: 2147483646;";
  const shadow = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = `
    .pill { font-family: Inter, -apple-system, "Segoe UI", sans-serif; display: flex; align-items: center; gap: 8px;
      background: #111113; color: #f3f4f6; border: 1px solid rgba(16,185,129,0.35); border-radius: 999px;
      padding: 8px 12px; font-size: 12.5px; box-shadow: 0 6px 24px rgba(0,0,0,0.45); cursor: pointer; }
    .pill:hover { border-color: rgba(16,185,129,0.7); }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: #00e599; flex: none; }
    .x { background: none; border: none; color: #6b7280; cursor: pointer; font-size: 13px; padding: 0 0 0 2px; }
    .detail { margin-top: 8px; background: #111113; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px;
      padding: 12px 14px; font-size: 12px; color: #9ca3af; display: none; max-width: 260px; }
    .detail.open { display: block; }
    .detail strong { color: #f3f4f6; }
    .cta { display: block; margin-top: 10px; text-align: center; background: linear-gradient(135deg,#00e599,#00b87a);
      color: #fff; border-radius: 9px; padding: 8px; text-decoration: none; font-weight: 600; }
  `;

  const wrap = document.createElement("div");
  const message =
    saving !== null
      ? `Cards cost ~$${saving.toFixed(2)} more here. FurlPay: 0.5%`
      : "This checkout charges ~2.9% card fees. FurlPay: 0.5%";

  // --- Pill row (safe DOM API — no innerHTML) ---
  const pill = document.createElement("div");
  pill.className = "pill";
  pill.setAttribute("role", "button");

  const dot = document.createElement("span");
  dot.className = "dot";
  pill.appendChild(dot);

  const msgSpan = document.createElement("span");
  msgSpan.textContent = message;
  pill.appendChild(msgSpan);

  const dismissBtn = document.createElement("button");
  dismissBtn.className = "x";
  dismissBtn.type = "button";
  dismissBtn.setAttribute("aria-label", "Dismiss");
  dismissBtn.textContent = "\u00D7"; // ×
  pill.appendChild(dismissBtn);

  wrap.appendChild(pill);

  // --- Detail panel ---
  const detail = document.createElement("div");
  detail.className = "detail";

  /** Helper: creates <div>label <strong>value</strong></div> */
  const infoLine = (label: string, value: string): HTMLDivElement => {
    const row = document.createElement("div");
    row.appendChild(document.createTextNode(label));
    const strong = document.createElement("strong");
    strong.textContent = value;
    row.appendChild(strong);
    return row;
  };

  if (total !== null && fees !== null) {
    detail.appendChild(infoLine("Order total: ", `$${total.toFixed(2)}`));
    detail.appendChild(infoLine("Typical card cost (2.9% + $0.30): ", `$${fees.cardFee.toFixed(2)}`));
    detail.appendChild(infoLine("FurlPay stablecoin checkout (0.5%): ", `$${fees.furlFee.toFixed(2)}`));
  } else {
    const fallback = document.createElement("div");
    fallback.appendChild(document.createTextNode("FurlPay settles in USDC on Arbitrum for a flat "));
    const strong = document.createElement("strong");
    strong.textContent = "0.5%";
    fallback.appendChild(strong);
    fallback.appendChild(document.createTextNode(" \u2014 no interchange, no decline fees."));
    detail.appendChild(fallback);
  }

  const cta = document.createElement("a");
  cta.className = "cta";
  cta.href = "https://furlpay.com/pricing";
  cta.target = "_blank";
  cta.rel = "noreferrer";
  cta.textContent = "See merchant pricing";
  detail.appendChild(cta);

  wrap.appendChild(detail);

  // --- Event listeners ---
  pill.addEventListener("click", () => detail.classList.toggle("open"));
  dismissBtn.addEventListener("click", async (e) => {
    e.stopPropagation();
    const { feeScannerDismissed } = await browser.storage.local.get("feeScannerDismissed");
    await browser.storage.local.set({
      feeScannerDismissed: { ...(feeScannerDismissed ?? {}), [location.hostname]: Date.now() },
    });
    host.remove();
  });

  shadow.append(style, wrap);
  document.documentElement.appendChild(host);
}
