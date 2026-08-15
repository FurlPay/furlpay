import { NextRequest, NextResponse } from "next/server";
import { randomInt } from "crypto";
import { requireUser } from "@/lib/authz";
import { BankingSchema, parse } from "@/lib/schemas";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { withIdempotency } from "@/lib/idempotency";
import type { UserAccount } from "@/lib/store";

// GET /api/banking — list the caller's provisioned virtual accounts.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  return NextResponse.json({ accounts: auth.account.fiatBalances });
}

// POST /api/banking — provision a virtual local account (Wise / BaaS).
// body: { currency: "USD" | "EUR" | "GBP" | "INR" }
const PROVISION: Record<string, () => Record<string, string>> = {
  USD: () => ({ routingNumber: "026073150", accountNumber: rand(10), bankAddress: "Cross River Bank, NJ, USA" }),
  EUR: () => ({ iban: "BE71 0961 " + rand(4) + " " + rand(4), swift: "TRWIBEB1XXX", bankAddress: "Wise Europe SA, Brussels" }),
  GBP: () => ({ sortCode: "23-14-70", accountNumber: rand(8), bankAddress: "Wise Payments Ltd, London" }),
  INR: () => ({ accountNumber: "UPI: ashutosh@furlpay", ifsc: "YESB0000001", bankAddress: "Partner Bank, Mumbai" }),
};

// Retries are safe: send an Idempotency-Key header (UUID) to replay the
// original response. Provisioning is also idempotent by currency — see
// provisionAccount.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  // Provisioning a payable account number is money-adjacent, so it gets a
  // per-user budget tighter than the middleware baseline.
  const limited = await rateLimitOr429(req, "banking.provision", { limit: 10, windowMs: 60_000 }, account.user.id);
  if (limited) return limited;

  const parsed = parse(BankingSchema, await req.json().catch(() => ({})));
  if (!parsed.ok) return parsed.res;
  const { currency } = parsed.data;
  if (!PROVISION[currency]) return NextResponse.json({ error: "Unsupported currency" }, { status: 400 });

  // Scope the key per user so one client's key can't replay (or conflict with)
  // another account's request.
  return withIdempotency(req.headers.get("Idempotency-Key"), `banking.provision:${account.user.id}`, async () =>
    provisionAccount(account, currency)
  );
}

function provisionAccount(account: UserAccount, currency: string): NextResponse {
  // Provisioning is idempotent PER CURRENCY, not just per Idempotency-Key: an
  // account number is a payable destination, so regenerating one that already
  // exists would silently invalidate any inbound wire already in flight to the
  // old details. A second call returns what was issued the first time.
  const existing = account.fiatBalances.find((f) => f.currency === currency);
  const localDetails = (existing?.localDetails as Record<string, string> | undefined) ?? PROVISION[currency]();
  if (!existing) {
    account.fiatBalances.push({ currency, amount: 0, usdValue: 0, localDetails: localDetails as any });
  }

  return NextResponse.json({
    accountName: `Furlpay · ${account.user.name}`,
    currency,
    ...localDetails,
  });
}

function rand(len: number): string {
  return Array.from({ length: len }, () => randomInt(0, 10)).join("");
}
