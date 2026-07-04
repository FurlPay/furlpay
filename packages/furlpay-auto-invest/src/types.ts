export type Frequency = "daily" | "weekly" | "monthly";

export interface Schedule {
  id: string;
  /** Ticker to buy, e.g. "VOO", "AAPL", "BTC". */
  symbol: string;
  /** USD notional to buy each run (funded in `currency`). */
  amount: number;
  /** Settlement currency for the buy. Default "USDC". */
  currency: string;
  frequency: Frequency;
  /** For weekly schedules: 0 (Sun) – 6 (Sat). Default 1 (Mon). */
  dayOfWeek?: number;
  /** For monthly schedules: 1 – 28. Default 1. */
  dayOfMonth?: number;
  /** UTC hour to run, 0 – 23. Default 14 (post US market open). */
  hour?: number;
  /** Whether the schedule is active. Default true. */
  active: boolean;
  /** ISO timestamp the schedule was created. */
  createdAt: string;
  /** ISO timestamp of the last successful run, if any. */
  lastRun?: string;
}

export interface ScheduleInput {
  symbol: string;
  amount: number;
  currency?: string;
  frequency: Frequency;
  dayOfWeek?: number;
  dayOfMonth?: number;
  hour?: number;
  active?: boolean;
}

export interface OrderResult {
  scheduleId: string;
  symbol: string;
  amount: number;
  currency: string;
  status: string;
  orderId?: string;
  simulated?: boolean;
  ranAt: string;
  error?: string;
}

export interface AutoInvestOptions {
  /** FurlPay API key. Omit to run in demo mode (orders are simulated). */
  apiKey?: string;
  /** API base URL. Default https://api.furlpay.com/v1 */
  baseUrl?: string;
  /** Override the fetch implementation (Node 18+ provides a global fetch). */
  fetchImpl?: typeof fetch;
  /** Seed with existing schedules (e.g. loaded from a database). */
  schedules?: Schedule[];
}
