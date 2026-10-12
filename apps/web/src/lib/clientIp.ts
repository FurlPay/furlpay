// ---------------------------------------------------------------------------
// The ONE place the application decides who the client is.
// docs/release/CLIENT_IP_TRUST_MODEL.md has the full derivation; the short form:
//
// A browser can send any header, so no IP header is trustworthy by itself.
// Trust comes from WHICH infrastructure wrote the value:
//
//   Vercel (FURLPAY_TRUSTED_PROXY_HOPS unset)
//     The platform overwrites x-real-ip / x-forwarded-for at its edge.
//
//   AWS (FURLPAY_TRUSTED_PROXY_HOPS=2): client → CloudFront → ALB → ECS
//     The origin request policy forwards EVERY viewer header, so x-real-ip and
//     anything the client put in x-forwarded-for arrive intact. Each proxy
//     APPENDS the address of the connection it accepted:
//       CloudFront appends the viewer; the ALB (xff mode "append", pinned in
//       edge.tf) appends the CloudFront edge. Next.js only sets the header when
//       it is absent — it never appends (verified on next 15.5.26).
//     So the chain the task sees is  <client-typed…>, <viewer>, <edge>
//     and the viewer is entry N from the RIGHT. Entries left of it are
//     attacker-controlled and are never read.
//     A request that did not traverse both proxies cannot reach the task: the
//     ALB security group admits only CloudFront's prefix list and the listener
//     404s anything without the X-Origin-Verify secret (edge.tf, originVerify.ts).
//
// Returns null when trust cannot be established — never a placeholder that
// looks like an address. Callers decide what null means for them
// (rateLimit.ts: a shared, strict "untrusted" bucket).
//
// Edge-runtime safe (middleware imports it): no Node APIs.
// ---------------------------------------------------------------------------

/** Longest x-forwarded-for tail examined. Only the last N entries matter, so a
 *  huge client-supplied prefix costs nothing beyond this bound. */
export const MAX_FORWARDED_CHARS = 2048;
/** Upper bound on a configured hop count: more proxies than this is a typo. */
const MAX_HOPS = 8;

export type ProxyTrust =
  | { mode: "platform" } // Vercel / local dev: the platform sets the IP headers
  | { mode: "hops"; hops: number } // AWS: count appended X-Forwarded-For entries
  | { mode: "invalid"; value: string }; // misconfigured: trust nothing

type Env = Record<string, string | undefined>;

export function proxyTrust(env: Env = process.env): ProxyTrust {
  const raw = env.FURLPAY_TRUSTED_PROXY_HOPS;
  if (raw === undefined || raw.trim() === "") return { mode: "platform" };
  const v = raw.trim();
  if (!/^[1-9]\d*$/.test(v)) return { mode: "invalid", value: raw };
  const hops = Number(v);
  if (hops > MAX_HOPS) return { mode: "invalid", value: raw };
  return { mode: "hops", hops };
}

const V4_OCTET = "(?:25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const V4 = new RegExp(`^${V4_OCTET}(?:\\.${V4_OCTET}){3}$`);
const HEXTET = /^[0-9a-fA-F]{1,4}$/;

/** The eight 16-bit groups of an IPv6 address (any RFC 4291 text form), or null. */
export function parseV6Groups(s: string): number[] | null {
  if (s.length > 45 || s.includes("%")) return null; // zone ids never identify a remote client
  const parts = s.split("::");
  if (parts.length > 2) return null;
  const side = (x: string): number[] | null => {
    if (x === "") return [];
    const out: number[] = [];
    const items = x.split(":");
    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      if (i === items.length - 1 && it.includes(".")) {
        if (!V4.test(it)) return null;
        const o = it.split(".").map(Number);
        out.push((o[0] << 8) | o[1], (o[2] << 8) | o[3]);
      } else if (HEXTET.test(it)) out.push(parseInt(it, 16));
      else return null;
    }
    return out;
  };
  const head = side(parts[0]);
  const tail = parts.length === 2 ? side(parts[1]) : [];
  if (!head || !tail) return null;
  if (parts.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  if (fill < 1) return null; // "::" must stand for at least one group
  return [...head, ...Array(fill).fill(0), ...tail];
}

/** RFC 5952 text form: lowercase, no leading zeros, longest zero run (≥2) as "::". */
function formatV6(g: number[]): string {
  let best = -1, bestLen = 0;
  for (let i = 0; i < 8; ) {
    if (g[i] !== 0) { i++; continue; }
    let j = i;
    while (j < 8 && g[j] === 0) j++;
    if (j - i > bestLen && j - i >= 2) { best = i; bestLen = j - i; }
    i = j;
  }
  const hex = g.map((x) => x.toString(16));
  if (best < 0) return hex.join(":");
  return `${hex.slice(0, best).join(":")}::${hex.slice(best + bestLen).join(":")}`;
}

/**
 * One address as a proxy writes it, normalised; null if it is not exactly one
 * IP. Accepts the forms AWS documents: `a.b.c.d`, `a.b.c.d:port`, `v6`,
 * `[v6]`, `[v6]:port`. IPv4-mapped IPv6 collapses to the IPv4 address so one
 * client cannot hold two rate-limit identities.
 */
export function normalizeIp(raw: string | null | undefined): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s || s.length > 64) return null;
  const bracketed = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(s);
  if (bracketed) s = bracketed[1];
  else if (/^[\d.]+:\d{1,5}$/.test(s)) s = s.slice(0, s.lastIndexOf(":"));
  if (V4.test(s)) return s;
  if (!s.includes(":")) return null;
  const g = parseV6Groups(s);
  if (!g) return null;
  const mapped = g.slice(0, 5).every((x) => x === 0) && g[5] === 0xffff;
  if (mapped) return `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  return formatV6(g);
}

/** The x-forwarded-for entries, bounded to the tail that can matter. */
function forwardedTail(value: string): string[] {
  let v = value;
  if (v.length > MAX_FORWARDED_CHARS) {
    v = v.slice(v.length - MAX_FORWARDED_CHARS);
    const cut = v.indexOf(",");
    v = cut < 0 ? "" : v.slice(cut + 1); // drop the entry the cut split in half
  }
  return v.split(",").map((x) => x.trim());
}

/**
 * The client's IP address, or null when it cannot be established from values
 * written by trusted infrastructure.
 */
export function trustedClientIp(req: Pick<Request, "headers"> | undefined, env: Env = process.env): string | null {
  if (!req) return null;
  const trust = proxyTrust(env);
  if (trust.mode === "invalid") return null; // boot refuses this in production (bootConfig.ts)

  const xff = req.headers.get("x-forwarded-for");
  if (trust.mode === "hops") {
    if (!xff) return null;
    const chain = forwardedTail(xff);
    if (chain.length < trust.hops) return null; // did not traverse every proxy
    // Every proxy-written entry must be an address; otherwise the chain is not
    // what the proxies produce and none of it is evidence.
    for (let i = chain.length - trust.hops + 1; i < chain.length; i++) {
      if (normalizeIp(chain[i]) === null) return null;
    }
    return normalizeIp(chain[chain.length - trust.hops]);
  }

  // Platform mode: the platform overwrote these, so the first value is the client.
  const real = req.headers.get("x-real-ip");
  if (real) return normalizeIp(real);
  return xff ? normalizeIp(xff.split(",", 1)[0]) : null;
}

/**
 * The client's country (ISO-3166 alpha-2), or null.
 *
 * Only on Vercel, where the platform sets `x-vercel-ip-country` from the
 * connection. Behind CloudFront the header would be whatever the viewer sent
 * (every viewer header is forwarded, and the configured policy adds no
 * CloudFront-Viewer-Country), so there is no trustworthy value and this
 * returns null rather than a client-chosen country.
 */
export function trustedClientCountry(req: Pick<Request, "headers"> | undefined, env: Env = process.env): string | null {
  if (!req || proxyTrust(env).mode !== "platform") return null;
  const c = req.headers.get("x-vercel-ip-country")?.trim().toUpperCase() ?? "";
  return /^[A-Z]{2}$/.test(c) && c !== "XX" ? c : null;
}

/** The /24 (IPv4) or /48 (IPv6) an address belongs to, or null if unknown. */
export function networkOf(ip: string | null): string | null {
  if (!ip) return null;
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.\d{1,3}$/.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.${v4[3]}.0/24`;
  if (ip.includes(":")) {
    const groups = ip.toLowerCase().split("::")[0].split(":").filter(Boolean);
    if (groups.length === 0) return null;
    return `${[...groups, "0", "0", "0"].slice(0, 3).join(":")}::/48`;
  }
  return null;
}
