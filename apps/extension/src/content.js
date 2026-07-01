// Furlpay content script — injects a "Pay with Furlpay" button next to detected
// checkout totals on merchant pages.
(function () {
  const PRICE_RE = /(?:USD|EUR|GBP|\$|€|£)\s?\d[\d,]*\.?\d{0,2}/;

  function parseAmount(text) {
    const m = text.replace(/,/g, "").match(/\d+(\.\d{1,2})?/);
    return m ? parseFloat(m[0]) : null;
  }

  function injectButton(target, amount) {
    if (document.getElementById("furlpay-pay-btn")) return;
    const btn = document.createElement("button");
    btn.id = "furlpay-pay-btn";
    btn.textContent = `Pay ${amount.toFixed(2)} with Furlpay`;
    Object.assign(btn.style, {
      display: "block",
      margin: "8px 0",
      padding: "12px 18px",
      background: "#FF3B30",
      color: "#fff",
      border: "none",
      borderRadius: "24px",
      fontWeight: "600",
      cursor: "pointer",
      fontFamily: "Inter, sans-serif",
    });
    btn.addEventListener("click", () => {
      chrome.runtime.sendMessage(
        { type: "FURLPAY_CREATE_CHECKOUT", payload: { amount, currency: "USD", token: "USDC" } },
        (resp) => {
          btn.textContent = resp && resp.ok ? "Paid ✓" : "Payment failed";
        }
      );
    });
    target.parentElement && target.parentElement.appendChild(btn);
  }

  function scan() {
    const nodes = document.querySelectorAll("[class*='total'], [id*='total'], [class*='price']");
    for (const node of nodes) {
      if (PRICE_RE.test(node.textContent || "")) {
        const amount = parseAmount(node.textContent || "");
        if (amount && amount > 0) {
          injectButton(node, amount);
          break;
        }
      }
    }
  }

  scan();
  new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });
})();
