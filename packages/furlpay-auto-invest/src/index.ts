import { isDue, nextRun } from "./schedule";
import {
  AutoInvestOptions,
  OrderResult,
  Schedule,
  ScheduleInput,
} from "./types";

export * from "./types";
export { isDue, nextRun } from "./schedule";

const DEFAULT_BASE = "https://api.furlpay.com/v1";

/**
 * Automated dollar-cost averaging (DCA) for FurlPay — "buy $10 of VOO every
 * Monday with USDC".
 *
 * You own the schedules (create them here or seed from your own store); the
 * runner decides which are due at a given time and places a fractional market
 * order for each via the FurlPay investing API.
 *
 * Clone-and-run: with no API key, orders are **simulated** (nothing hits the
 * network) so you can watch the DCA loop end-to-end. Set an API key to execute
 * real buys.
 *
 * @example
 *   import { AutoInvest } from "@furlpay/auto-invest";
 *   const ai = new AutoInvest({ apiKey: process.env.FURLPAY_API_KEY });
 *   ai.add({ symbol: "VOO", amount: 10, frequency: "weekly", dayOfWeek: 1 });
 *   const results = await ai.runDue();   // call this on a cron (e.g. hourly)
 */
export class AutoInvest {
  private readonly apiKey?: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private schedules: Map<string, Schedule>;

  constructor(opts: AutoInvestOptions = {}) {
    this.apiKey = opts.apiKey || process.env.FURLPAY_API_KEY || undefined;
    this.baseUrl = (opts.baseUrl || process.env.FURLPAY_API_BASE || DEFAULT_BASE).replace(/\/$/, "");
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
    this.schedules = new Map((opts.schedules ?? []).map((s) => [s.id, s]));
    if (!this.fetchImpl) {
      throw new Error("AutoInvest: no fetch implementation available (Node 18+ required)");
    }
  }

  /** True when a FurlPay key is configured; otherwise orders are simulated. */
  get live(): boolean {
    return Boolean(this.apiKey);
  }

  // -- schedule management ------------------------------------------------

  add(input: ScheduleInput): Schedule {
    if (input.amount <= 0) throw new Error("AutoInvest: amount must be > 0");
    if (input.dayOfWeek !== undefined && (input.dayOfWeek < 0 || input.dayOfWeek > 6)) {
      throw new Error("AutoInvest: dayOfWeek must be 0-6");
    }
    if (input.dayOfMonth !== undefined && (input.dayOfMonth < 1 || input.dayOfMonth > 28)) {
      throw new Error("AutoInvest: dayOfMonth must be 1-28");
    }
    const schedule: Schedule = {
      id: "dca_" + Math.random().toString(36).slice(2, 10),
      symbol: input.symbol.toUpperCase(),
      amount: input.amount,
      currency: (input.currency ?? "USDC").toUpperCase(),
      frequency: input.frequency,
      dayOfWeek: input.dayOfWeek,
      dayOfMonth: input.dayOfMonth,
      hour: input.hour,
      active: input.active ?? true,
      createdAt: new Date().toISOString(),
    };
    this.schedules.set(schedule.id, schedule);
    return schedule;
  }

  list(): Schedule[] {
    return [...this.schedules.values()];
  }

  get(id: string): Schedule | undefined {
    return this.schedules.get(id);
  }

  pause(id: string): Schedule {
    return this.setActive(id, false);
  }

  resume(id: string): Schedule {
    return this.setActive(id, true);
  }

  remove(id: string): boolean {
    return this.schedules.delete(id);
  }

  /** Next scheduled fire time for a schedule, in UTC (the slot after its last run). */
  nextRunAt(id: string): Date {
    const s = this.require(id);
    return nextRun(s, new Date(s.lastRun ?? s.createdAt));
  }

  /** The schedules due to run at `now`. */
  due(now: Date = new Date()): Schedule[] {
    return this.list().filter((s) => isDue(s, now));
  }

  // -- execution ----------------------------------------------------------

  /** Place buys for every schedule due at `now`, recording `lastRun` on success. */
  async runDue(now: Date = new Date()): Promise<OrderResult[]> {
    const results: OrderResult[] = [];
    for (const s of this.due(now)) {
      results.push(await this.execute(s, now));
    }
    return results;
  }

  /** Force a single schedule to buy now (ignores due check). Used for "run now". */
  async runNow(id: string, now: Date = new Date()): Promise<OrderResult> {
    return this.execute(this.require(id), now);
  }

  private async execute(s: Schedule, now: Date): Promise<OrderResult> {
    const base: OrderResult = {
      scheduleId: s.id,
      symbol: s.symbol,
      amount: s.amount,
      currency: s.currency,
      status: "pending",
      ranAt: now.toISOString(),
    };
    try {
      const order = await this.placeOrder(s);
      s.lastRun = now.toISOString();
      this.schedules.set(s.id, s);
      return {
        ...base,
        status: order.status ?? (order.simulated ? "simulated" : "accepted"),
        orderId: order.id,
        simulated: order.simulated,
      };
    } catch (e) {
      return { ...base, status: "failed", error: (e as Error).message };
    }
  }

  private async placeOrder(
    s: Schedule,
  ): Promise<{ id?: string; status?: string; simulated?: boolean }> {
    const body = { symbol: s.symbol, side: "buy", notional: s.amount, currency: s.currency };
    if (!this.live) {
      return { id: "ord_sim_" + Math.random().toString(36).slice(2, 8), status: "simulated", simulated: true };
    }
    const res = await this.fetchImpl(`${this.baseUrl}/investing/orders`, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    const json = text ? JSON.parse(text) : {};
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  }

  private setActive(id: string, active: boolean): Schedule {
    const s = this.require(id);
    s.active = active;
    this.schedules.set(id, s);
    return s;
  }

  private require(id: string): Schedule {
    const s = this.schedules.get(id);
    if (!s) throw new Error(`AutoInvest: no schedule ${id}`);
    return s;
  }
}

export default AutoInvest;
