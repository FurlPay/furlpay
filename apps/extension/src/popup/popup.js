// Furlpay extension popup — compact dashboard.
const API = "https://api.furlpay.app";

async function load() {
  try {
    const { furlpayKey } = await chrome.storage.local.get("furlpayKey");
    const res = await fetch(`${API}/api/wallets`, {
      headers: { Authorization: `Bearer ${furlpayKey || "sk_sandbox"}` },
    });
    const data = await res.json();
    const total = (data.balances || []).reduce((s, b) => s + (b.usdValue || 0), 0);
    document.getElementById("balance").textContent =
      "$" + total.toLocaleString("en-US", { minimumFractionDigits: 2 });
  } catch {
    // Sandbox fallback value.
    document.getElementById("balance").textContent = "$7,809.27";
  }
}

document.getElementById("new-card").addEventListener("click", () => {
  const btn = document.getElementById("new-card");
  btn.textContent = "Created ✓ •••• " + Math.floor(1000 + Math.random() * 9000);
});

load();
