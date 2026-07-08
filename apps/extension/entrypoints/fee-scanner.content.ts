// Merchant fee comparison scanner — the "Honey for payment fees".
// On checkout-looking pages, shows a small dismissible pill comparing typical
// card processing cost (~2.9% + $0.30) against FurlPay's 0.5% flat.
// Heuristics only, read-only, shadow-DOM isolated; never touches page forms.

const CHECKOUT_HINTS = /checkout|payment|cart|billing|order|book(ing)?/i;
const CARD_FEE_PCT = 0.029;
const CARD_FEE_FIXED = 0.3;
const FURLPAY_FEE_PCT = 0.005;

export default defineContentScript({
  matches: ["<all_urls>"],
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
  const amountRe = /(?:\$|USD\s?)(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/g;
  const candidates: { value: number; weighted: boolean }[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let node: Node | null;
  let scanned = 0;
  while ((node = walker.nextNode()) && scanned < 4000) {
    scanned += 1;
    const text = node.textContent ?? "";
    if (text.length > 200) continue;
    let m: RegExpExecArray | null;
    while ((m = amountRe.exec(text))) {
      const value = parseFloat(m[1].replace(/,/g, ""));
      if (!Number.isFinite(value) || value <= 0 || value > 100_000) continue;
      const context = (node.parentElement?.textContent ?? "").slice(0, 120).toLowerCase();
      candidates.push({ value, weighted: /total|amount due|pay/.test(context) });
    }
  }
  if (!candidates.length) return null;
  const weighted = candidates.filter((c) => c.weighted);
  const pool = weighted.length ? weighted : candidates;
  return Math.max(...pool.map((c) => c.value));
}

function renderPill(total: number | null) {
  const cardFee = total !== null ? total * CARD_FEE_PCT + CARD_FEE_FIXED : null;
  const furlFee = total !== null ? total * FURLPAY_FEE_PCT : null;
  const saving = cardFee !== null && furlFee !== null ? cardFee - furlFee : null;

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
  wrap.innerHTML = `
    <div class="pill" role="button">
      <span class="dot"></span>
      <span>${message}</span>
      <button class="x" type="button" aria-label="Dismiss">&times;</button>
    </div>
    <div class="detail">
      ${
        total !== null
          ? `<div>Order total: <strong>$${total.toFixed(2)}</strong></div>
             <div>Typical card cost (2.9% + $0.30): <strong>$${(total * CARD_FEE_PCT + CARD_FEE_FIXED).toFixed(2)}</strong></div>
             <div>FurlPay stablecoin checkout (0.5%): <strong>$${(total * FURLPAY_FEE_PCT).toFixed(2)}</strong></div>`
          : `<div>FurlPay settles in USDC on Arbitrum for a flat <strong>0.5%</strong> — no interchange, no decline fees.</div>`
      }
      <a class="cta" href="https://furlpay.com/pricing" target="_blank" rel="noreferrer">See merchant pricing</a>
    </div>
  `;

  const detail = wrap.querySelector<HTMLDivElement>(".detail")!;
  wrap.querySelector<HTMLDivElement>(".pill")!.addEventListener("click", () => detail.classList.toggle("open"));
  wrap.querySelector<HTMLButtonElement>(".x")!.addEventListener("click", async (e) => {
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
