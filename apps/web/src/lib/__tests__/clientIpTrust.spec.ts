import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative, sep } from "path";
import { MAX_FORWARDED_CHARS, normalizeIp, proxyTrust, trustedClientIp } from "../clientIp";
import { rateLimitIdentity } from "../rateLimit";
import { clientIpFrom } from "../cards/rainNetwork";
import { edgeTrustProblems } from "../bootConfig";

// docs/release/CLIENT_IP_TRUST_MODEL.md. Per-IP limits (OTP, auth, the API
// baseline, money routes) key on trustedClientIp(). Behind CloudFront → ALB
// every viewer header is forwarded, so the client controls x-real-ip and the
// LEFT of x-forwarded-for; only the entries the proxies append are evidence.

const AWS = { FURLPAY_TRUSTED_PROXY_HOPS: "2" };
const VERCEL = {};
const EDGE = "130.176.0.1"; // what the ALB appends: the CloudFront edge
const req = (h: Record<string, string> | [string, string][]) => ({ headers: new Headers(h) });
/** The x-forwarded-for the ECS task receives: <client-typed…>, viewer, edge. */
const viaCloudFront = (viewer: string, clientTyped: string[] = []) => ({
  "x-forwarded-for": [...clientTyped, viewer, EDGE].join(", "),
});

describe("AWS: CloudFront → ALB → ECS (hops = 2)", () => {
  it("trusted request → the viewer CloudFront appended", () => {
    expect(trustedClientIp(req(viaCloudFront("203.0.113.7")), AWS)).toBe("203.0.113.7");
  });

  it("direct spoof: client-typed XFF / X-Real-IP never become the identity", () => {
    const r = req({ "x-real-ip": "198.51.100.1", ...viaCloudFront("203.0.113.7", ["198.51.100.1"]) });
    expect(trustedClientIp(r, AWS)).toBe("203.0.113.7");
  });

  it("rotating spoofed values does not rotate the rate-limit identity", () => {
    const ids = new Set(
      ["9.9.9.1", "9.9.9.2", "9.9.9.3", "::1", "garbage"].map((fake) =>
        trustedClientIp(req({ "x-real-ip": fake, ...viaCloudFront("203.0.113.7", [fake, fake]) }), AWS)
      )
    );
    expect([...ids]).toEqual(["203.0.113.7"]);
  });

  it("the attacker cannot place a value in the trusted slot (it is written after theirs)", () => {
    // Everything the attacker sends lands LEFT of what CloudFront appends.
    const r = req(viaCloudFront("203.0.113.7", ["1.1.1.1", "2.2.2.2", EDGE]));
    expect(trustedClientIp(r, AWS)).toBe("203.0.113.7");
  });

  it("a chain shorter than the proxy path (did not traverse it) → null", () => {
    expect(trustedClientIp(req({ "x-forwarded-for": "203.0.113.7" }), AWS)).toBeNull();
    expect(trustedClientIp(req({ "x-real-ip": "203.0.113.7" }), AWS)).toBeNull();
    // …and a short chain never falls back to a client-typed header.
    expect(trustedClientIp(req({ "x-forwarded-for": "203.0.113.7", "x-real-ip": "198.51.100.1" }), AWS)).toBeNull();
    expect(trustedClientIp(req({}), AWS)).toBeNull();
    expect(trustedClientIp(undefined, AWS)).toBeNull();
  });

  it("a malformed proxy-written entry voids the chain", () => {
    expect(trustedClientIp(req({ "x-forwarded-for": "203.0.113.7, not-an-ip" }), AWS)).toBeNull();
    expect(trustedClientIp(req({ "x-forwarded-for": "203.0.113.7, " }), AWS)).toBeNull();
  });

  it("a malformed viewer entry → null, never the neighbour", () => {
    for (const bad of ["1.2.3", "999.999.999.999", "hello", "", "1.2.3.4 evil", "01.2.3.4"]) {
      expect(trustedClientIp(req({ "x-forwarded-for": `8.8.8.8, ${bad}, ${EDGE}` }), AWS)).toBeNull();
    }
  });

  it("IPv6 viewers, in every form AWS documents, normalise to one identity", () => {
    for (const v of ["2001:4860:4860::8888", "2001:4860:4860:0:0:0:0:8888", "[2001:4860:4860::8888]", "[2001:4860:4860::8888]:443", "2001:4860:4860:0000:0000:0000:0000:8888"]) {
      expect(trustedClientIp(req(viaCloudFront(v)), AWS)).toBe("2001:4860:4860::8888");
    }
  });

  it("mixed IPv4/IPv6 chain and an IPv6 edge", () => {
    expect(trustedClientIp(req({ "x-forwarded-for": "10.0.0.1, 203.0.113.7, 2600:9000:1::1" }), AWS)).toBe("203.0.113.7");
    expect(trustedClientIp(req({ "x-forwarded-for": "10.0.0.1, 2001:db8::1, 130.176.0.1" }), AWS)).toBe("2001:db8::1");
  });

  it("IPv4:port as the ALB may write it", () => {
    expect(trustedClientIp(req({ "x-forwarded-for": "203.0.113.7:51234, 130.176.0.1:443" }), AWS)).toBe("203.0.113.7");
  });

  it("duplicate header lines are one ordered list (Headers joins them), same answer", () => {
    const split = req([
      ["x-forwarded-for", "9.9.9.9"],
      ["x-forwarded-for", `203.0.113.7, ${EDGE}`],
    ]);
    expect(split.headers.get("x-forwarded-for")).toBe(`9.9.9.9, 203.0.113.7, ${EDGE}`);
    expect(trustedClientIp(split, AWS)).toBe("203.0.113.7");
  });

  it("duplicate addresses are harmless", () => {
    expect(trustedClientIp(req({ "x-forwarded-for": `203.0.113.7, 203.0.113.7, ${EDGE}` }), AWS)).toBe("203.0.113.7");
  });

  it("a very long client prefix is bounded and cannot displace the trusted entries", () => {
    const junk = Array.from({ length: 20_000 }, (_, i) => `10.${(i >> 8) & 255}.${i & 255}.1`);
    const r = req(viaCloudFront("203.0.113.7", junk));
    expect(r.headers.get("x-forwarded-for")!.length).toBeGreaterThan(MAX_FORWARDED_CHARS * 50);
    const t0 = performance.now();
    expect(trustedClientIp(r, AWS)).toBe("203.0.113.7");
    expect(performance.now() - t0).toBeLessThan(50);
  });

  it("the cut at the bound never turns half an entry into the viewer", () => {
    // The viewer entry itself straddling the bound is impossible (it is within
    // the last two entries), but prove a split prefix entry is discarded.
    const pad = "1".repeat(MAX_FORWARDED_CHARS);
    expect(trustedClientIp(req({ "x-forwarded-for": `${pad}, 203.0.113.7, ${EDGE}` }), AWS)).toBe("203.0.113.7");
  });
});

describe("Vercel / platform mode (unset)", () => {
  it("uses the platform-written headers", () => {
    expect(trustedClientIp(req({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "203.0.113.7" }), VERCEL)).toBe("203.0.113.7");
    expect(trustedClientIp(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }), VERCEL)).toBe("203.0.113.7");
  });
  it("still refuses a malformed value instead of keying on it", () => {
    expect(trustedClientIp(req({ "x-real-ip": "hello" }), VERCEL)).toBeNull();
    expect(trustedClientIp(req({}), VERCEL)).toBeNull();
  });
});

describe("configuration fails closed", () => {
  it("invalid hop counts trust nothing", () => {
    for (const bad of ["0", "-1", "two", "2x", "1.5", "9", " 02"]) {
      expect(proxyTrust({ FURLPAY_TRUSTED_PROXY_HOPS: bad }).mode).toBe("invalid");
      expect(trustedClientIp(req(viaCloudFront("203.0.113.7")), { FURLPAY_TRUSTED_PROXY_HOPS: bad })).toBeNull();
    }
    expect(proxyTrust({ FURLPAY_TRUSTED_PROXY_HOPS: " 2 " })).toEqual({ mode: "hops", hops: 2 });
  });

  it("production boot refuses CloudFront without a hop count or public origin", () => {
    expect(edgeTrustProblems({ ORIGIN_VERIFY_REQUIRED: "true" })).toHaveLength(4);
    const aws = { ORIGIN_VERIFY_REQUIRED: "true", FURLPAY_TRUSTED_PROXY_HOPS: "2", PUBLIC_API_ORIGIN: "https://api.furlpay.com", FURLPAY_RP_ID: "furlpay.com", FURLPAY_ORIGIN: "https://api.furlpay.com" };
    expect(edgeTrustProblems(aws)).toEqual([]);
    // Production never hands out loopback / bind-address URLs.
    expect(edgeTrustProblems({ ...aws, FURLPAY_ORIGIN: "http://localhost:3000" })).toHaveLength(1);
    expect(edgeTrustProblems({ ...aws, FURLPAY_RP_ID: "localhost" })).toHaveLength(1);
    expect(edgeTrustProblems({ PUBLIC_API_ORIGIN: "https://0.0.0.0:3000" }).some((p) => /loopback|bind/.test(p))).toBe(true);
    expect(edgeTrustProblems({ FURLPAY_TRUSTED_PROXY_HOPS: "zero" })).toHaveLength(1);
    expect(edgeTrustProblems({ PUBLIC_API_ORIGIN: "http://api.furlpay.com" })).toHaveLength(1);
    expect(edgeTrustProblems({})).toEqual([]); // Vercel / dev
  });
});

describe("normalizeIp", () => {
  it.each([
    ["127.0.0.1", "127.0.0.1"],
    ["8.8.8.8", "8.8.8.8"],
    ["::1", "::1"],
    ["2001:4860:4860::8888", "2001:4860:4860::8888"],
    ["2001:DB8:0:0:1:0:0:1", "2001:db8::1:0:0:1"], // RFC 5952: first longest run
    ["::ffff:192.168.1.1", "192.168.1.1"], // IPv4-mapped collapses to one identity
    ["::ffff:c0a8:101", "192.168.1.1"],
    ["[::1]:8080", "::1"],
    ["1.2.3.4:80", "1.2.3.4"],
  ])("%s → %s", (input, want) => {
    expect(normalizeIp(input)).toBe(want);
  });

  it.each(["1.2.3", "999.999.999.999", "hello", "1.2.3.4, evil", "", "1.2.3.4.5", "::1::", "fe80::1%eth0", "2001:db8::g", "1:2:3:4:5:6:7:8:9", "0x7f.0.0.1", "[1.2.3.4]:x"])(
    "rejects %j",
    (bad) => {
      expect(normalizeIp(bad)).toBeNull();
    }
  );
});

describe("one trust model for every IP decision", () => {
  it("rate limiting keys on the trusted IP; unknown shares ONE strict bucket", () => {
    const prev = process.env.FURLPAY_TRUSTED_PROXY_HOPS;
    process.env.FURLPAY_TRUSTED_PROXY_HOPS = "2";
    try {
      expect(rateLimitIdentity(req({ "x-real-ip": "1.1.1.1", ...viaCloudFront("203.0.113.7", ["1.1.1.1"]) }))).toBe("203.0.113.7");
      // Rotating a forged header on a chain-less request buys no new budget.
      expect(new Set(["1.1.1.1", "2.2.2.2"].map((x) => rateLimitIdentity(req({ "x-real-ip": x }))))).toEqual(new Set(["untrusted"]));
      expect(clientIpFrom({ "x-forwarded-for": `34.66.230.233, 198.51.100.4, ${EDGE}` })).toBe("198.51.100.4");
    } finally {
      if (prev === undefined) delete process.env.FURLPAY_TRUSTED_PROXY_HOPS;
      else process.env.FURLPAY_TRUSTED_PROXY_HOPS = prev;
    }
  });
});

// ---------------------------------------------------------------------------
// Source tripwires: a new reader of a proxy-supplied header fails CI.
// ---------------------------------------------------------------------------
const SRC = join(__dirname, "..", "..");
function sources(): { path: string; src: string }[] {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const f = join(d, n);
      if (statSync(f).isDirectory()) {
        if (n !== "__tests__" && n !== "node_modules") walk(f);
      } else if (/\.tsx?$/.test(n) && !/\.(spec|test)\.tsx?$/.test(n)) out.push(f);
    }
  };
  walk(SRC);
  return out.map((f) => ({
    path: relative(SRC, f).split(sep).join("/"),
    src: readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1"),
  }));
}

describe("tripwires", () => {
  const FILES = sources();

  it("no file but lib/clientIp.ts reads a client-address header", () => {
    const re = /["'](x-forwarded-for|x-real-ip|cf-connecting-ip|true-client-ip|x-client-ip|client-ip|forwarded|fastly-client-ip|x-cluster-client-ip|cloudfront-viewer-address)["']/i;
    expect(FILES.filter((f) => re.test(f.src) && f.path !== "lib/clientIp.ts").map((f) => f.path)).toEqual([]);
  });

  it("nothing reads x-forwarded-host / -proto / -port / -prefix", () => {
    const re = /["']x-forwarded-(host|proto|port|prefix)["']/i;
    expect(FILES.filter((f) => re.test(f.src)).map((f) => f.path)).toEqual([]);
  });

  it("no request-derived origin outside lib/publicOrigin.ts", () => {
    // On ECS these are the bind address (https://0.0.0.0:3000); use publicOrigin().
    const re = /new URL\((req|request)\.url\)\.origin|(req|request)\.nextUrl\.origin|nextUrl\.clone\(\)|new URL\([^)]*,\s*(req|request)\.url\s*\)/;
    expect(FILES.filter((f) => re.test(f.src) && f.path !== "lib/publicOrigin.ts").map((f) => f.path)).toEqual([]);
  });
});
