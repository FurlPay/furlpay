// FurlPay Blink detector — makes the extension a Blink-aware client.
// Scans pages (social feeds, forums, chat webapps) for shared FurlPay Action
// links (furlpay.com/pay/…, /book…, /api/actions/…) and appends a small trust
// badge so users can tell a genuine 1-click FurlPay checkout from a lookalike.
// Read-only: no page-form access, no external requests, shadow-DOM isolated.

const BLINK_HREF =
  /^https:\/\/(www\.)?furlpay\.com\/(pay\/|book([/?]|$)|api\/actions\/)/;
const BADGE_ATTR = "data-furlpay-blink";
const MAX_BADGES_PER_PAGE = 200;
const SCAN_THROTTLE_MS = 1500;

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_idle",
  main() {
    // Never annotate FurlPay's own pages (or local dev).
    if (/(^|\.)furlpay\.com$/.test(location.hostname) || location.hostname === "localhost") {
      return;
    }

    let badgeCount = 0;
    let scanQueued = false;
    let lastScan = 0;

    function scan() {
      if (badgeCount >= MAX_BADGES_PER_PAGE) return;
      lastScan = Date.now();
      const anchors = document.querySelectorAll<HTMLAnchorElement>(
        `a[href^="https://furlpay.com/"]:not([${BADGE_ATTR}]), a[href^="https://www.furlpay.com/"]:not([${BADGE_ATTR}])`
      );
      for (const a of anchors) {
        if (badgeCount >= MAX_BADGES_PER_PAGE) break;
        a.setAttribute(BADGE_ATTR, "1"); // mark even on non-match to avoid re-checks
        if (!BLINK_HREF.test(a.href)) continue;
        a.after(makeBadge(a.href));
        badgeCount += 1;
      }
    }

    // SPA feeds (X, Reddit, Discord web) render lazily — rescan on mutations,
    // throttled so we never busy-loop on chatty pages.
    function queueScan() {
      if (scanQueued || badgeCount >= MAX_BADGES_PER_PAGE) return;
      scanQueued = true;
      setTimeout(
        () => {
          scanQueued = false;
          scan();
        },
        Math.max(0, SCAN_THROTTLE_MS - (Date.now() - lastScan))
      );
    }

    scan();
    const observer = new MutationObserver(queueScan);
    observer.observe(document.body ?? document.documentElement, {
      childList: true,
      subtree: true,
    });
  },
});

/** Small inline pill rendered in its own shadow root so page CSS can't
 *  restyle it into something misleading (and vice versa). */
function makeBadge(href: string): HTMLElement {
  const host = document.createElement("span");
  host.setAttribute(BADGE_ATTR, "badge");
  const root = host.attachShadow({ mode: "closed" });

  const style = document.createElement("style");
  style.textContent = `
    .pill {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      margin-left: 6px;
      padding: 1px 8px;
      border-radius: 999px;
      border: 1px solid rgba(255, 59, 48, 0.45);
      background: rgba(255, 59, 48, 0.12);
      color: #ff3b30;
      font: 600 11px/1.6 -apple-system, "Segoe UI", Roboto, sans-serif;
      cursor: pointer;
      vertical-align: middle;
      white-space: nowrap;
      user-select: none;
    }
    .pill:hover { background: rgba(255, 59, 48, 0.2); }
  `;

  const pill = document.createElement("span");
  pill.className = "pill";
  pill.textContent = "FurlPay 1-click checkout";
  pill.title = "Verified FurlPay Action link — pays via Solana in one click";
  pill.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    // href was validated against BLINK_HREF (https://furlpay.com/... only).
    window.open(href, "_blank", "noopener,noreferrer");
  });

  root.append(style, pill);
  return host;
}
