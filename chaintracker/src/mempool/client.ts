// The Bitcoin data client.
//
// This is the only file that knows a Bitcoin API host exists, and it is built
// around one measured fact: THERE IS NO SINGLE HOST THAT WORKS.
//
// Measured 2026-09-08 from the development machine:
//   - mempool.space         — every one of its seven anycast addresses times
//                             out at connect. Not a 4xx, not a 5xx: no TCP.
//                             Reachable from elsewhere, so it stays in the
//                             list, but it cannot be the only entry.
//   - mempool.emzy.de       — 200, same codebase, same /api/v1 surface. Rate
//                             limits hard: 25 requests at one every 2s came
//                             back 429 every single time, and it kept
//                             refusing for minutes afterwards.
//   - blockstream.info      — 200, Esplora only (no /api/v1/*). Took 183
//                             requests in 52s with zero 429s, which is what
//                             makes whole-block enumeration affordable.
//
// So hosts are ordered per capability rather than globally: the heavy Esplora
// walking goes to blockstream first, while the /v1 statistics that only a
// mempool instance serves go to mempool.space then emzy. Each host carries its
// own breaker and its own rate limit, and a host that is refusing is skipped
// rather than retried into the ground.

import { Provider } from "../providers/base.js";
import { env } from "../config/env.js";
import { CircuitBreaker, CircuitOpenError, HttpError, RateLimiter } from "../util/resilience.js";
import { makeLogger } from "../util/logger.js";

const log = makeLogger("btc-client");

/**
 * What an endpoint needs from a host.
 *   esplora — the base block/tx/address/mempool API. Every host has it.
 *   v1      — mempool.space's own additions: recommended fees, projected
 *             blocks, difficulty adjustment, hashrate, price. Esplora-only
 *             hosts return 404 for these, so asking the wrong host is a bug,
 *             not a fallback.
 */
export type Capability = "esplora" | "v1";

export interface HostSpec {
  base: string;
  caps: Capability[];
  /** Sustained request rate this host tolerates, measured not guessed. */
  rps: number;
  note: string;
}

export const DEFAULT_HOSTS: HostSpec[] = [
  {
    base: "https://blockstream.info/api",
    caps: ["esplora"],
    rps: 3,
    note: "Esplora only; the only host measured to tolerate whole-block walking",
  },
  {
    base: "https://mempool.space/api",
    caps: ["esplora", "v1"],
    rps: 2,
    note: "canonical; unreachable from some networks, kept for the ones where it works",
  },
  {
    base: "https://mempool.emzy.de/api",
    caps: ["esplora", "v1"],
    rps: 0.3,
    note: "community mirror; 429s aggressively above ~0.5 rps",
  },
];

/** Hosts for a capability, in the order they should be tried. */
export function hostsFor(hosts: HostSpec[], cap: Capability): HostSpec[] {
  // Esplora work is bulk work — hundreds of requests to walk one block — so the
  // host that tolerates the highest rate leads. /v1 work is a handful of calls
  // per run, so throughput is irrelevant there and the list order stands.
  const usable = hosts.filter((h) => h.caps.includes(cap));
  return cap === "esplora" ? usable.slice().sort((a, b) => b.rps - a.rps) : usable;
}

export class NoHostError extends Error {
  constructor(cap: Capability, tried: string[], last: string | null) {
    super(
      `no host answered for ${cap} (tried ${tried.join(", ") || "none"})` +
        (last ? `; last error: ${last}` : ""),
    );
    this.name = "NoHostError";
  }
}

/**
 * Reads Bitcoin state from whichever host is currently answering.
 *
 * Extends `Provider` for the usage accounting and health reporting the rest of
 * the app expects, but does its own per-host limiting and breaking — the base
 * class models one endpoint, and the whole point here is that there are three.
 */
export class BitcoinClient extends Provider {
  private readonly hosts: HostSpec[];
  private readonly limiters = new Map<string, RateLimiter>();
  private readonly breakers = new Map<string, CircuitBreaker>();
  /** Host that most recently answered, per capability — tried first next time. */
  private readonly sticky = new Map<Capability, string>();

  constructor(hosts: HostSpec[] = DEFAULT_HOSTS) {
    super({
      name: "bitcoin",
      kind: "blockchain",
      configured: true, // every host is keyless
      rps: 3,
      timeoutMs: 15_000,
      attempts: 1, // retries are the host loop's job, not the base class's
    });
    this.hosts = hosts;
    for (const h of hosts) {
      this.limiters.set(h.base, new RateLimiter(h.base, h.rps));
      // A short cooldown: hosts here fail by being unreachable or rate limited,
      // and both recover on their own within a minute or two.
      this.breakers.set(h.base, new CircuitBreaker(h.base, 3, 90_000));
    }
  }

  /** Hosts currently refusing calls, for the health line in the board footer. */
  degradedHosts(): Array<{ base: string; state: string; error: string | null }> {
    const out: Array<{ base: string; state: string; error: string | null }> = [];
    for (const [base, b] of this.breakers) {
      if (b.state !== "closed") out.push({ base, state: b.state, error: b.lastError });
    }
    return out;
  }

  /**
   * GET `path` from the first host that answers.
   *
   * Returns the parsed body together with the host that served it, because a
   * number with no provenance is not reportable — the embeds print the host in
   * the footer and the snapshot records it.
   */
  async fetchJson<T>(
    cap: Capability,
    path: string,
    opts: { timeoutMs?: number; asText?: false } = {},
  ): Promise<{ data: T; host: string }> {
    return this.attempt<T>(cap, path, opts.timeoutMs ?? 15_000, false) as Promise<{ data: T; host: string }>;
  }

  /** Same, for endpoints that return a bare string (tip hash, tip height). */
  async fetchText(
    cap: Capability,
    path: string,
    opts: { timeoutMs?: number } = {},
  ): Promise<{ data: string; host: string }> {
    return this.attempt<string>(cap, path, opts.timeoutMs ?? 15_000, true) as Promise<{
      data: string;
      host: string;
    }>;
  }

  private async attempt<T>(
    cap: Capability,
    path: string,
    timeoutMs: number,
    asText: boolean,
  ): Promise<{ data: T | string; host: string }> {
    const ordered = this.orderedHosts(cap);
    const tried: string[] = [];
    let lastErr: string | null = null;

    for (const h of ordered) {
      const breaker = this.breakers.get(h.base)!;
      if (!breaker.canRequest()) {
        lastErr = `${h.base}: circuit ${breaker.state} (${breaker.lastError ?? "no detail"})`;
        continue;
      }
      tried.push(hostLabel(h.base));
      const started = Date.now();
      try {
        await this.limiters.get(h.base)!.acquire();
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), timeoutMs);
        let res: Response;
        try {
          res = await fetch(h.base + path, {
            headers: { accept: asText ? "text/plain" : "application/json" },
            signal: ctl.signal,
          });
        } finally {
          clearTimeout(timer);
        }
        if (!res.ok) {
          throw new HttpError(res.status, await res.text().catch(() => ""), hostLabel(h.base) + path);
        }
        const data = asText ? ((await res.text()).trim() as T | string) : ((await res.json()) as T);
        breaker.onSuccess();
        this.sticky.set(cap, h.base);
        this.noteSuccess(Date.now() - started);
        return { data, host: hostLabel(h.base) };
      } catch (err) {
        lastErr = `${hostLabel(h.base)}: ${errText(err)}`;
        breaker.onFailure(err);
        this.noteFailure(lastErr, Date.now() - started);
        log.debug("host failed over", { host: hostLabel(h.base), path, err: errText(err).slice(0, 120) });
      }
    }
    throw new NoHostError(cap, tried, lastErr);
  }

  /** Last host that worked for this capability first, then the static order. */
  private orderedHosts(cap: Capability): HostSpec[] {
    const ordered = hostsFor(this.hosts, cap);
    const last = this.sticky.get(cap);
    if (!last) return ordered;
    const idx = ordered.findIndex((h) => h.base === last);
    if (idx <= 0) return ordered;
    return [ordered[idx]!, ...ordered.slice(0, idx), ...ordered.slice(idx + 1)];
  }

  /* The base class keeps its accounting private, so the per-host loop reports
   * into it through these two rather than by reaching into its internals. */
  private okCount = 0;
  private failCount = 0;
  private latency = 0;

  private noteSuccess(ms: number): void {
    this.okCount += 1;
    this.latency += ms;
    this.lastOkAt = Date.now();
  }

  private noteFailure(err: string, ms: number): void {
    this.failCount += 1;
    this.latency += ms;
    this.lastErrorAt = Date.now();
    this.lastError = err.slice(0, 300);
  }

  /** Requests made and refused since construction — printed by the watcher. */
  stats(): { ok: number; failed: number; avgMs: number } {
    const total = this.okCount + this.failCount;
    return {
      ok: this.okCount,
      failed: this.failCount,
      avgMs: total ? Math.round(this.latency / total) : 0,
    };
  }

  async ping(): Promise<boolean> {
    try {
      const { data } = await this.fetchText("esplora", "/blocks/tip/height", { timeoutMs: 8000 });
      return /^\d+$/.test(data);
    } catch {
      return false;
    }
  }
}

function hostLabel(base: string): string {
  try {
    return new URL(base).hostname;
  } catch {
    return base;
  }
}

function errText(err: unknown): string {
  if (err instanceof CircuitOpenError) return err.message;
  if (err instanceof HttpError) return `HTTP ${err.status}`;
  if (err instanceof Error) {
    return err.name === "AbortError" || err.name === "TimeoutError" ? "timeout" : err.message;
  }
  return String(err);
}

/** Hosts from the environment, falling back to the measured defaults. */
export function hostsFromEnv(): HostSpec[] {
  const raw = process.env.BTC_API_HOSTS?.trim();
  if (!raw) return DEFAULT_HOSTS;
  const specs: HostSpec[] = [];
  for (const entry of raw.split(",").map((s) => s.trim()).filter(Boolean)) {
    // "https://host/api|esplora,v1|3" — caps and rps optional.
    const [base, caps, rps] = entry.split("|");
    if (!base) continue;
    const known = DEFAULT_HOSTS.find((h) => h.base === base);
    specs.push({
      base: base.replace(/\/$/, ""),
      caps: caps
        ? (caps.split("+").filter((c): c is Capability => c === "esplora" || c === "v1"))
        : (known?.caps ?? ["esplora"]),
      rps: rps && Number.isFinite(Number(rps)) ? Number(rps) : (known?.rps ?? 1),
      note: known?.note ?? "from BTC_API_HOSTS",
    });
  }
  if (!specs.length) {
    log.warn("BTC_API_HOSTS set but nothing parsed from it — using defaults");
    return DEFAULT_HOSTS;
  }
  return specs;
}

/** A client built from the environment. */
export function makeClient(): BitcoinClient {
  void env; // env is loaded for its side effect of reading .env
  return new BitcoinClient(hostsFromEnv());
}
