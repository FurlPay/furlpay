// MAIN-world interceptor: patches fetch + XMLHttpRequest so the page's own
// requests reveal HTTP 402 Payment Required responses. x402 servers put
// PaymentRequirements in the JSON body ({ accepts: [...] }); we clone the
// response, parse it, and relay to the isolated-world script via
// window.postMessage. Nothing sensitive runs here — this world is
// page-accessible by definition, so it only OBSERVES and forwards.

export default defineContentScript({
  matches: ["<all_urls>"],
  world: "MAIN",
  runAt: "document_start",
  main() {
    const MARK = "furlpay-x402-detected";

    function report(url: string, method: string, body: unknown) {
      let requirements: unknown[] = [];
      if (body && typeof body === "object") {
        const b = body as Record<string, unknown>;
        if (Array.isArray(b.accepts)) requirements = b.accepts;
        else if (b.maxAmountRequired || b.payTo || b.asset) requirements = [b];
      }
      window.postMessage(
        {
          source: MARK,
          detection: {
            url,
            method,
            requirements,
            detectedAt: new Date().toISOString(),
          },
        },
        "*"
      );
    }

    // --- fetch ---------------------------------------------------------------
    const origFetch = window.fetch.bind(window);
    window.fetch = async (...args: Parameters<typeof fetch>) => {
      const res = await origFetch(...args);
      if (res.status === 402) {
        const method =
          args[0] instanceof Request ? args[0].method : ((args[1]?.method as string) ?? "GET");
        res
          .clone()
          .json()
          .then((body) => report(res.url, method.toUpperCase(), body))
          .catch(() => report(res.url, method.toUpperCase(), null));
      }
      return res;
    };

    // --- XMLHttpRequest --------------------------------------------------------
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: any[]) {
      this.addEventListener("load", () => {
        if (this.status !== 402) return;
        let body: unknown = null;
        try {
          body = JSON.parse(this.responseText);
        } catch {
          /* non-JSON 402 */
        }
        report(String(url), method.toUpperCase(), body);
      });
      return (origOpen as any).call(this, method, url, ...rest);
    };
  },
});
