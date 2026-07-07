/**
 * Thin FurlPay REST client used by the tool provider.
 *
 * Clone-and-run: with no FURLPAY_API_KEY set, every method returns deterministic
 * demo data (writes *simulate* rather than touch the network), so an agent can be
 * wired up and its tool calls observed without an account. Set FURLPAY_API_KEY
 * (and optionally FURLPAY_API_BASE) to hit the live API at
 * https://api.furlpay.com/v1 instead. Reads fail soft to demo data.
 *
 * Zero runtime dependencies — uses the global `fetch` (Node 18+).
 */

const DEFAULT_BASE = "https://api.furlpay.com/v1";
const USER_AGENT = "furlpay-vercel-ai/0.1.0";

export interface FurlPayClientOptions {
  apiKey?: string;
  baseUrl?: string;
}

export class FurlPayClient {
  readonly apiKey?: string;
  readonly baseUrl: string;

  constructor(opts: FurlPayClientOptions = {}) {
    this.apiKey = opts.apiKey || undefined;
    this.baseUrl = (opts.baseUrl || DEFAULT_BASE).replace(/\/$/, "");
  }

  static fromEnv(): FurlPayClient {
    return new FurlPayClient({
      apiKey: process.env.FURLPAY_API_KEY || undefined,
      baseUrl: process.env.FURLPAY_API_BASE || DEFAULT_BASE,
    });
  }

  /** True when a key is configured; otherwise every call runs on demo data. */
  get live(): boolean {
    return Boolean(this.apiKey);
  }

  private headers(): Record<string, string> {
    return {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: "application/json",
      "User-Agent": USER_AGENT,
    };
  }

  private async get<T>(path: string): Promise<T> {
    const r = await fetch(`${this.baseUrl}${path}`, { headers: this.headers() });
    if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
    return (await r.json()) as T;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const r = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { ...this.headers(), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`POST ${path} → ${r.status}`);
    return (await r.json()) as T;
  }

  // -- reads ----------------------------------------------------------------

  async walletBalances(): Promise<unknown> {
    if (!this.live) return DEMO_BALANCES;
    try {
      const data = await this.get<unknown>("/wallets/balances");
      return Array.isArray(data) ? data : (data as { data?: unknown }).data ?? [];
    } catch {
      return markDemo(DEMO_BALANCES);
    }
  }

  async x402Config(): Promise<unknown> {
    if (!this.live) return DEMO_X402_CONFIG;
    try {
      return await this.get("/x402/config");
    } catch {
      return { ...DEMO_X402_CONFIG, _demo: true };
    }
  }

  async agentBudget(agentId: string): Promise<unknown> {
    if (!this.live) return { ...DEMO_AGENT_BUDGET, agent_id: agentId };
    try {
      return await this.get(`/x402/agent-budget/${agentId}`);
    } catch {
      return { ...DEMO_AGENT_BUDGET, agent_id: agentId, _demo: true };
    }
  }

  async swapQuote(fromToken: string, toToken: string, amount: number): Promise<unknown> {
    const from = fromToken.toUpperCase();
    const to = toToken.toUpperCase();
    if (!this.live) {
      const rate = DEMO_RATES[`${from}->${to}`] ?? 1.0;
      return { from, to, amount_in: amount, amount_out: round6(amount * rate), rate, route: "demo", _demo: true };
    }
    return this.post("/swaps/quote", { fromToken: from, toToken: to, amountIn: amount });
  }

  // -- writes (execution) ---------------------------------------------------

  async createPayment(amount: number, currency = "USDC", description = ""): Promise<unknown> {
    const body = { amount, currency: currency.toUpperCase(), description };
    if (!this.live) {
      return simulatedAck("payment", {
        ...body,
        id: "pay_demo_" + shortId(),
        checkout_url: "https://checkout.furlpay.com/demo/" + shortId(),
        status: "requires_payment",
      });
    }
    return this.post("/payments/checkout", body);
  }

  async sendTransfer(to: string, amount: number, token = "USDC"): Promise<unknown> {
    const body = { to, amount, token: token.toUpperCase() };
    if (!this.live) return simulatedAck("transfer", { ...body, id: "tr_demo_" + shortId(), status: "pending" });
    return this.post("/transfers", body);
  }

  async placeInvestmentOrder(symbol: string, side: string, notional: number): Promise<unknown> {
    const body = { symbol: symbol.toUpperCase(), side: side.toLowerCase(), notional, currency: "USDC" };
    if (!this.live) return simulatedAck("order", { ...body, id: "ord_demo_" + shortId(), status: "accepted" });
    return this.post("/investing/orders", body);
  }

  async setAgentBudget(agentId: string, limit: number, period = "daily"): Promise<unknown> {
    const body = { agent_id: agentId, limit, period, currency: "USDC" };
    if (!this.live) return simulatedAck("agent-budget", { ...body, spent: 0, remaining: limit });
    return this.post("/x402/agent-budget", body);
  }

  async createX402Paywall(resource: string, price: number, network = "solana"): Promise<unknown> {
    const body = { resource, price_usdc: price, network };
    if (!this.live) {
      return simulatedAck("paywall", { ...body, id: "pw_demo_" + shortId(), pay_to: "FurLDemo11111111111111111111111111111111111" });
    }
    return this.post("/x402/create-paywall", body);
  }

  async verifyX402Payment(paymentProof: string): Promise<unknown> {
    if (!this.live) return { valid: true, amount: 0.01, currency: "USDC", simulated: true, _demo: true };
    return this.post("/x402/verify", { proof: paymentProof });
  }

  async settleX402Payment(paymentProof: string): Promise<unknown> {
    if (!this.live) return { settled: true, tx: "demo_tx_" + shortId(), simulated: true, _demo: true };
    return this.post("/x402/settle", { proof: paymentProof });
  }

  async payForResource(url: string, maxAmount = 1.0, agentId = "agent_default"): Promise<unknown> {
    if (!this.live) {
      const price = 0.01;
      if (price > maxAmount) return { paid: false, reason: "price exceeds max_amount", price, max_amount: maxAmount, _demo: true };
      return {
        paid: true,
        simulated: true,
        url,
        price_usdc: price,
        agent_id: agentId,
        settlement_tx: "demo_tx_" + shortId(),
        content: { note: "Demo 402 payload — set FURLPAY_API_KEY to fetch real gated content." },
        _demo: true,
      };
    }
    const r = await fetch(url, { headers: this.headers() });
    if (r.status !== 402) return { paid: false, status_code: r.status, content: await safeJson(r) };
    const challenge = (await r.json()) as { accepts?: Array<Record<string, unknown>> };
    const accepts = (challenge.accepts || [{}])[0];
    const price = Number(accepts.maxAmountRequired ?? accepts.amount ?? 0) || 0;
    if (price > maxAmount) return { paid: false, reason: "price exceeds max_amount", price, max_amount: maxAmount };
    const settled = (await this.post("/x402/settle", { challenge, agent_id: agentId })) as Record<string, string>;
    const header = settled.payment_header || settled.proof || "";
    const r2 = await fetch(url, { headers: { ...this.headers(), "X-PAYMENT": header } });
    return { paid: true, url, price_usdc: price, settlement: settled, status_code: r2.status, content: await safeJson(r2) };
  }
}

// -- helpers ----------------------------------------------------------------

function markDemo(rows: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return rows.map((r) => ({ ...r, source: "demo" }));
}

function simulatedAck(kind: string, body: Record<string, unknown>): Record<string, unknown> {
  return {
    success: true,
    simulated: true,
    kind,
    detail: "Demo mode — set FURLPAY_API_KEY to execute against the live API.",
    ...body,
  };
}

async function safeJson(r: Response): Promise<unknown> {
  try {
    return await r.json();
  } catch {
    return (await r.text()).slice(0, 2000);
  }
}

const round6 = (n: number): number => Math.round(n * 1e6) / 1e6;
const shortId = (): string => Math.abs(Date.now() ^ Math.floor(Math.random() * 0xffffff)).toString(16).slice(0, 6);

// -- demo fixtures ----------------------------------------------------------

const DEMO_BALANCES = [
  { token: "USDC", network: "Solana", balance: 3120.1, usd_value: 3120.1 },
  { token: "USDC", network: "Base", balance: 480.0, usd_value: 480.0 },
  { token: "SOL", network: "Solana", balance: 6.42, usd_value: 1123.5 },
];

const DEMO_X402_CONFIG = {
  chains: ["solana", "base"],
  tokens: ["USDC"],
  facilitator: "https://api.furlpay.com/v1/x402",
  max_amount_usdc: 100,
  replay_tolerance_seconds: 300,
};

const DEMO_AGENT_BUDGET = {
  agent_id: "agent_default",
  period: "daily",
  limit: 25.0,
  spent: 4.37,
  remaining: 20.63,
  currency: "USDC",
};

const DEMO_RATES: Record<string, number> = {
  "SOL->USDC": 175.0,
  "USDC->SOL": 1 / 175.0,
  "USDC->USDT": 0.9997,
  "USDT->USDC": 1.0003,
};
