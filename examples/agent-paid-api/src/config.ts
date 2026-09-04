// ---------------------------------------------------------------------------
// One place that decides which rail this example runs on, and says so loudly.
//
// The default is the TEST rail. That is a deliberate inversion of the usual
// "mock unless configured" pattern being safe: here the example's entire
// purpose is demonstrating the control plane, and a developer who has not
// configured a chain should get a working demo that is honest about being one
// — not a broken one, and not a fake one.
//
// Production is the opposite and lives elsewhere: apps/web's integration guard
// fails CLOSED when live credentials are missing. An example demo and a
// payment server have different correct defaults.
// ---------------------------------------------------------------------------

export type RailKind = "test" | "solana-devnet";

export interface ExampleConfig {
  rail: RailKind;
  network: string;
  /** Token mint. On the test rail this is a label; on devnet it must be the
   *  real USDC mint, because a symbol is a claim and a mint is a fact. */
  asset: string;
  payTo: string;
  quoteSecret: string;
  port: number;
  priceAtomic: string;
  /** 6dp, matching USDC. */
  decimals: number;
}

/** Circle's USDC mint on Solana devnet. Used only when the devnet rail is
 *  explicitly selected; never as a default. */
export const DEVNET_USDC_MINT = "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU";

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ExampleConfig {
  const rail: RailKind = env.FURLPAY_RAIL === "solana-devnet" ? "solana-devnet" : "test";

  if (rail === "solana-devnet") {
    // Fail closed. A devnet run with no recipient would otherwise fall back to
    // a placeholder and settle nowhere.
    const payTo = env.FURLPAY_PAY_TO;
    if (!payTo) {
      throw new Error(
        "FURLPAY_RAIL=solana-devnet requires FURLPAY_PAY_TO (the merchant's devnet public key)."
      );
    }
    return {
      rail,
      network: "solana-devnet",
      asset: env.FURLPAY_USDC_MINT ?? DEVNET_USDC_MINT,
      payTo,
      quoteSecret: requireSecret(env),
      port: Number(env.PORT ?? 4021),
      priceAtomic: env.FURLPAY_PRICE_ATOMIC ?? "1000",
      decimals: 6,
    };
  }

  return {
    rail,
    network: "test-network",
    asset: "TEST-USDC",
    payTo: "TESTRAIL-merchant",
    quoteSecret: env.FURLPAY_QUOTE_SECRET ?? "example-only-quote-secret-not-for-production",
    port: Number(env.PORT ?? 4021),
    priceAtomic: env.FURLPAY_PRICE_ATOMIC ?? "1000", // 0.001 at 6dp
    decimals: 6,
  };
}

function requireSecret(env: NodeJS.ProcessEnv): string {
  const s = env.FURLPAY_QUOTE_SECRET;
  if (!s || s.length < 16) {
    // The quote MAC is what stops a payment minted for a cheap resource
    // unlocking an expensive one. A published default would be a forgeable
    // quote for every deployment that did not override it.
    throw new Error("FURLPAY_QUOTE_SECRET must be set (16+ chars) when running against a real rail.");
  }
  return s;
}

/** Atomic units to a human string, without floating point. */
export function formatAtomic(atomic: string, decimals: number): string {
  const negative = atomic.startsWith("-");
  const digits = (negative ? atomic.slice(1) : atomic).padStart(decimals + 1, "0");
  const whole = digits.slice(0, digits.length - decimals);
  const frac = digits.slice(digits.length - decimals);
  return `${negative ? "-" : ""}${whole}.${frac}`;
}
