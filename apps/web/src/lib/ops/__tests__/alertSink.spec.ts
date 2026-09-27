import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkDestination,
  deliverSecurityAlert,
  resetAlertSinkWarning,
  setAlertTransport,
  signAlert,
  verifyAlertSignature,
  type SecurityAlert,
} from "../alertSink";

// ---------------------------------------------------------------------------
// Outbound security-alert delivery.
//
// TWO THINGS ARE BEING TESTED, AND THE SECOND ONE IS THE SECURITY CONTROL.
//
// 1. Alerts actually get delivered, retried sensibly, and never twice.
// 2. A CONFIGURABLE OUTBOUND URL INSIDE A PAYMENTS BACKEND IS AN SSRF PRIMITIVE.
//    Whoever sets FURLPAY_ALERT_WEBHOOK gets the server to make an authenticated
//    request to an address of their choosing. On a cloud host that means the
//    instance metadata endpoint and every internal service reachable from inside
//    the perimeter. The destination check is the real feature here; the fetch is
//    plumbing.
//
// Delivery must also never be able to break the thing that raised the alert. A
// statutory disclosure failing because a webhook timed out would be a monitoring
// control causing the incident.
// ---------------------------------------------------------------------------

const ALERT: SecurityAlert = {
  id: "sec_test_1",
  kind: "anomaly_kyc_access",
  severity: "high",
  detail: "Actor adm_x performed 16 kyc_access actions in 600s.",
  actor: "adm_x",
  ts: "2026-09-27T00:00:00Z",
};

const GOOD_URL = "https://alerts.example.com/hook";
const SECRET = "a-signing-secret-long-enough";

let seq = 0;
const freshAlert = (over: Partial<SecurityAlert> = {}): SecurityAlert => ({
  ...ALERT,
  id: `sec_${Date.now()}_${seq++}`,
  ...over,
});

beforeEach(() => {
  resetAlertSinkWarning();
  process.env.FURLPAY_ALERT_WEBHOOK = GOOD_URL;
  process.env.FURLPAY_ALERT_WEBHOOK_SECRET = SECRET;
});

afterEach(() => {
  setAlertTransport(null);
  delete process.env.FURLPAY_ALERT_WEBHOOK;
  delete process.env.FURLPAY_ALERT_WEBHOOK_SECRET;
});

describe("SSRF: which destinations are refused", () => {
  it.each([
    ["cloud metadata (AWS/GCP link-local)", "https://169.254.169.254/latest/meta-data/"],
    ["GCP metadata by name", "https://metadata.google.internal/computeMetadata/v1/"],
    // The ONLY entry in METADATA_HOSTS not also caught by a shape rule: it is a
    // public-looking FQDN with no private range and no .internal suffix. A
    // mutation study removing the explicit list survived because this case was
    // missing here, making the list look redundant when it is not.
    ["GCP metadata short name", "https://metadata.goog/computeMetadata/v1/"],
    ["AWS IPv6 metadata", "https://[fd00:ec2::254]/latest/"],
    ["Alibaba metadata", "https://100.100.100.200/latest/"],
    ["loopback v4", "https://127.0.0.1/hook"],
    ["loopback name", "https://localhost/hook"],
    ["loopback v6", "https://[::1]/hook"],
    ["RFC1918 10/8", "https://10.0.0.5/hook"],
    ["RFC1918 172.16/12", "https://172.20.1.1/hook"],
    ["RFC1918 192.168/16", "https://192.168.1.1/hook"],
    ["CGNAT 100.64/10", "https://100.100.0.1/hook"],
    ["link-local v6", "https://[fe80::1]/hook"],
    ["unique-local v6", "https://[fd12:3456::1]/hook"],
    // WHATWG URL rewrites the dotted form to hex — `[::ffff:a00:1]` — so a check
    // written against the spelling a human would type never matches what the
    // parser produces. This accepted 10.0.0.1 as public until it was fixed.
    ["IPv4-mapped private v6 (dotted)", "https://[::ffff:10.0.0.1]/hook"],
    ["IPv4-mapped private v6 (hex, as URL normalises it)", "https://[::ffff:a00:1]/hook"],
    ["IPv4-mapped loopback", "https://[::ffff:127.0.0.1]/hook"],
    ["IPv4-mapped 192.168", "https://[::ffff:192.168.1.1]/hook"],
    ["IPv4-mapped metadata", "https://[::ffff:169.254.169.254]/hook"],
    ["IPv4-compatible (deprecated) private", "https://[::a00:1]/hook"],
    ["fully-expanded IPv4-mapped loopback", "https://[0:0:0:0:0:ffff:127.0.0.1]/hook"],
    ["GCP internal DNS suffix", "https://admin.c.my-project.internal/hook"],
    ["mDNS", "https://printer.local/hook"],
    ["unqualified hostname", "https://vault/hook"],
    ["0.0.0.0", "https://0.0.0.0/hook"],
  ])("refuses %s", (_label, url) => {
    const r = checkDestination(url);
    expect(r.ok, `${url} was ACCEPTED`).toBe(false);
  });

  it("refuses plain http", () => {
    // An alert names which of an attacker's actions were noticed. In clear text
    // that is a live feed to anyone on the path.
    expect(checkDestination("http://alerts.example.com/hook").ok).toBe(false);
  });

  it.each([
    ["ftp", "ftp://alerts.example.com/x"],
    ["file", "file:///etc/passwd"],
    ["gopher", "gopher://alerts.example.com/"],
  ])("refuses %s scheme", (_l, url) => {
    expect(checkDestination(url).ok).toBe(false);
  });

  it("refuses credentials embedded in the URL", () => {
    // Every proxy in between logs them, and the secret belongs in the signing
    // key rather than the address.
    expect(checkDestination("https://user:pass@alerts.example.com/hook").ok).toBe(false);
  });

  it("refuses a malformed URL and an empty destination", () => {
    expect(checkDestination("not a url").ok).toBe(false);
    expect(checkDestination("").ok).toBe(false);
    expect(checkDestination(undefined).ok).toBe(false);
  });

  it("accepts a genuinely public https destination", () => {
    // The control has to leave the legitimate case working, or it gets removed.
    expect(checkDestination(GOOD_URL).ok).toBe(true);
    expect(checkDestination("https://hooks.slack.com/services/T/B/x").ok).toBe(true);
    expect(checkDestination("https://events.pagerduty.com/v2/enqueue").ok).toBe(true);
  });

  it("does not follow redirects, so a 302 cannot escape the check", () => {
    // checkDestination only ever sees the ORIGINAL url. Without redirect:manual
    // a public host could bounce the request to 169.254.169.254 and every rule
    // above would have been decoration.
    const src = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "..", "alertSink.ts"),
      "utf8"
    );
    expect(src).toContain('redirect: "manual"');
  });
});

describe("signing", () => {
  it("round-trips", () => {
    const body = JSON.stringify({ a: 1 });
    const ts = "1700000000";
    expect(verifyAlertSignature(body, SECRET, ts, signAlert(body, SECRET, ts))).toBe(true);
  });

  it("rejects a tampered body", () => {
    // Without a signature, anyone who learns the webhook URL can post fabricated
    // alerts — including a flood designed to bury a real one.
    const ts = "1700000000";
    const sig = signAlert(JSON.stringify({ a: 1 }), SECRET, ts);
    expect(verifyAlertSignature(JSON.stringify({ a: 2 }), SECRET, ts, sig)).toBe(false);
  });

  it("rejects a replayed signature under a different timestamp", () => {
    const body = JSON.stringify({ a: 1 });
    const sig = signAlert(body, SECRET, "1700000000");
    expect(verifyAlertSignature(body, SECRET, "1700009999", sig)).toBe(false);
  });

  it("rejects the wrong secret and an empty signature", () => {
    const body = JSON.stringify({ a: 1 });
    const ts = "1700000000";
    expect(verifyAlertSignature(body, "other-secret-long-enough", ts, signAlert(body, SECRET, ts))).toBe(false);
    expect(verifyAlertSignature(body, SECRET, ts, "")).toBe(false);
  });

  it("refuses to send at all when no signing secret is set", async () => {
    // Sending unsigned would give the receiver a channel it trusts and anyone
    // can write to. Refusing is the safer failure.
    delete process.env.FURLPAY_ALERT_WEBHOOK_SECRET;
    const calls: string[] = [];
    setAlertTransport(async (u) => {
      calls.push(u);
      return { status: 200 };
    });
    const r = await deliverSecurityAlert(freshAlert());
    expect(r.delivered).toBe(false);
    expect(calls).toHaveLength(0);
    expect(r).toMatchObject({ reason: "refused" });
  });

  it.each(["x", "short", "0123456789abcde"])("refuses a weak signing secret %o", async (weak) => {
    // The ABSENT case above is caught almost by accident: createHmac throws on an
    // undefined key, so the send fails whether or not the length guard exists. A
    // SHORT secret does not throw — it signs, and it sends, with a key that can be
    // brute-forced. A mutation study removing the guard survived precisely because
    // only the absent case was covered.
    process.env.FURLPAY_ALERT_WEBHOOK_SECRET = weak;
    const calls: string[] = [];
    setAlertTransport(async (u) => {
      calls.push(u);
      return { status: 200 };
    });
    const r = await deliverSecurityAlert(freshAlert());
    expect(r).toMatchObject({ delivered: false, reason: "refused" });
    expect(calls, `sent with a ${weak.length}-character signing key`).toHaveLength(0);
  });
});

describe("delivery", () => {
  it("delivers a high-severity alert and signs it", async () => {
    let seen: { headers: Record<string, string>; body: string } | null = null;
    setAlertTransport(async (_u, init) => {
      seen = { headers: init.headers, body: init.body };
      return { status: 204 };
    });

    const alert = freshAlert();
    const r = await deliverSecurityAlert(alert);
    expect(r.delivered).toBe(true);
    expect(seen).not.toBeNull();
    const ts = seen!.headers["x-furlpay-timestamp"];
    expect(verifyAlertSignature(seen!.body, SECRET, ts, seen!.headers["x-furlpay-signature"])).toBe(true);
  });

  it.each(["info", "low", "medium"] as const)("does not page for %s severity", async (severity) => {
    // A sink that forwards everything trains its recipients to ignore it, which
    // is the same outcome as having no sink.
    const calls: string[] = [];
    setAlertTransport(async (u) => {
      calls.push(u);
      return { status: 200 };
    });
    const r = await deliverSecurityAlert(freshAlert({ severity }));
    expect(r.delivered).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("pages for critical as well as high", async () => {
    setAlertTransport(async () => ({ status: 200 }));
    expect((await deliverSecurityAlert(freshAlert({ severity: "critical" }))).delivered).toBe(true);
  });

  it("delivers the same event id only once", async () => {
    // A pager that fires twice for one incident is how responders learn to
    // ignore it. recordSecurityEvent can be reached twice on a retry.
    let calls = 0;
    setAlertTransport(async () => {
      calls++;
      return { status: 200 };
    });
    const alert = freshAlert();
    const first = await deliverSecurityAlert(alert);
    const second = await deliverSecurityAlert(alert);
    expect(first.delivered).toBe(true);
    expect(second).toMatchObject({ delivered: false, reason: "duplicate" });
    expect(calls).toBe(1);
  });

  it("retries a 5xx and succeeds", async () => {
    let calls = 0;
    setAlertTransport(async () => {
      calls++;
      return { status: calls < 3 ? 503 : 200 };
    });
    const r = await deliverSecurityAlert(freshAlert());
    expect(r.delivered).toBe(true);
    expect(calls).toBe(3);
  });

  it("does NOT retry a 4xx", async () => {
    // A rejected signature or disabled channel will not improve by repeating;
    // retrying it is a storm against a destination that already said no.
    let calls = 0;
    setAlertTransport(async () => {
      calls++;
      return { status: 401 };
    });
    const r = await deliverSecurityAlert(freshAlert());
    expect(r.delivered).toBe(false);
    expect(calls).toBe(1);
  });

  it("bounds retries and gives up", async () => {
    let calls = 0;
    setAlertTransport(async () => {
      calls++;
      return { status: 500 };
    });
    const r = await deliverSecurityAlert(freshAlert());
    expect(r).toMatchObject({ delivered: false, reason: "failed" });
    expect(calls).toBe(3);
  });

  it("survives a transport that throws, without propagating", async () => {
    // THE NON-BLOCKING CONTRACT. Callers are statutory disclosures and role
    // changes. None may fail because a monitoring webhook is unreachable.
    setAlertTransport(async () => {
      throw new Error("ECONNREFUSED");
    });
    const r = await deliverSecurityAlert(freshAlert());
    expect(r).toMatchObject({ delivered: false, reason: "failed" });
  });

  it("survives an aborted (timed out) transport", async () => {
    setAlertTransport(async (_u, init) => {
      const err = new Error("aborted");
      err.name = "AbortError";
      void init.signal;
      throw err;
    });
    const r = await deliverSecurityAlert(freshAlert());
    expect(r.delivered).toBe(false);
  });

  it("is a clean no-op when nothing is configured", async () => {
    // Production may legitimately have no sink yet. That must be a quiet,
    // honest no-op — not an exception and not a placeholder URL that 404s.
    delete process.env.FURLPAY_ALERT_WEBHOOK;
    const calls: string[] = [];
    setAlertTransport(async (u) => {
      calls.push(u);
      return { status: 200 };
    });
    const r = await deliverSecurityAlert(freshAlert());
    expect(r).toMatchObject({ delivered: false, reason: "not_configured" });
    expect(calls).toHaveLength(0);
  });

  it("refuses an SSRF destination at delivery time, not just in the checker", async () => {
    // The checker is only a control if the delivery path actually consults it.
    process.env.FURLPAY_ALERT_WEBHOOK = "https://169.254.169.254/latest/meta-data/";
    const calls: string[] = [];
    setAlertTransport(async (u) => {
      calls.push(u);
      return { status: 200 };
    });
    const r = await deliverSecurityAlert(freshAlert());
    expect(r).toMatchObject({ delivered: false, reason: "refused" });
    expect(calls, "an SSRF destination was actually called").toHaveLength(0);
  });
});

describe("the payload carries no customer data", () => {
  it("sends only kind, severity, detail, actor, id and timestamp", async () => {
    let body = "";
    setAlertTransport(async (_u, init) => {
      body = init.body;
      return { status: 200 };
    });
    await deliverSecurityAlert(freshAlert());
    const parsed = JSON.parse(body);
    expect(Object.keys(parsed).sort()).toEqual(
      ["actor", "detail", "id", "kind", "severity", "source", "ts"].sort()
    );
  });
});
