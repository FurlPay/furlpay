// Registers the "FurlPay x402" DevTools panel (the Network-tab-style
// inspector for HTTP 402 Payment Required traffic).
browser.devtools.panels.create("FurlPay x402", "/icon48.png", "/x402-panel.html");
