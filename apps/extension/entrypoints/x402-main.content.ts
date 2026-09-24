// MAIN-world interceptor: patches fetch + XMLHttpRequest so the page's own
// requests reveal HTTP 402 Payment Required responses. x402 servers put
// PaymentRequirements in the JSON body ({ accepts: [...] }); we clone the
// response, parse it, and relay to the isolated-world script via
// window.postMessage. Nothing sensitive runs here — this world is
// page-accessible by definition, so it only OBSERVES and forwards.

export default defineContentScript({
  // Payment hand-offs need a transport the network cannot rewrite. The
  // checkout path accepts HTTPS resources only, so do not inject an observer
  // into cleartext HTTP pages that can never produce a payable detection.
  matches: ["https://*/*"],
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
        // Scoped to this document's origin, NOT "*" — matching
        // wallet-announce and wallet-bridge, which both say the same thing and
        // were already doing it. The isolated-world listener lives in this same
        // window, so nothing legitimate needs a wildcard.
        //
        // What the wildcard leaked: every cross-origin iframe on the page — an
        // ad frame, an embedded widget, anything — received the URL of each
        // resource the user hit a 402 on, along with the advertised recipient
        // and amount. That is a running log of what the user is about to pay
        // for, handed to third parties that have no part in the payment.
        window.location.origin
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
    //
    // ONE listener per XHR object, not one per open() call.
    //
    // XMLHttpRequest objects are reusable: a page may call open() repeatedly on
    // the same instance, and the old code attached a fresh `load` listener each
    // time. A polling loop on a single XHR therefore accumulated listeners
    // without bound and reported the same 402 once per open() it had ever made.
    //
    // The listener reads `this.status` and `this.responseText` at fire time, so
    // a single registration stays correct across every later request the object
    // makes — the only thing that has to be re-read per call is the method and
    // URL, which is what `lastCall` carries.
    const ATTACHED = Symbol("furlpay-x402-listener");
    const origOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function (
      this: XMLHttpRequest & { [ATTACHED]?: { method: string; url: string } },
      method: string,
      url: string | URL,
      ...rest: any[]
    ) {
      const lastCall = { method: method.toUpperCase(), url: String(url) };
      const alreadyAttached = this[ATTACHED] !== undefined;
      this[ATTACHED] = lastCall;

      if (!alreadyAttached) {
        this.addEventListener("load", () => {
          if (this.status !== 402) return;
          const call = this[ATTACHED];
          if (!call) return;
          let body: unknown = null;
          try {
            body = JSON.parse(this.responseText);
          } catch {
            /* non-JSON 402 */
          }
          report(call.url, call.method, body);
        });
      }
      return (origOpen as any).call(this, method, url, ...rest);
    };
  },
});
