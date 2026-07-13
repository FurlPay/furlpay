import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/authz";
import { BankingSchema, parse } from "@/lib/schemas";

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

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const account = auth.account;

  const parsed = parse(BankingSchema, await req.json().catch(() => ({})));
  if (!parsed.ok) return parsed.res;
  const { currency } = parsed.data;
  const gen = PROVISION[currency];
  if (!gen) return NextResponse.json({ error: "Unsupported currency" }, { status: 400 });

  const localDetails = gen();
  let existing = account.fiatBalances.find((f) => f.currency === currency);
  if (existing) {
    existing.localDetails = localDetails as any;
  } else {
    existing = { currency, amount: 0, usdValue: 0, localDetails: localDetails as any };
    account.fiatBalances.push(existing);
  }

  return NextResponse.json({
    accountName: `Furlpay · ${account.user.name}`,
    currency,
    ...localDetails,
  });
}

function rand(len: number): string {
  return Array.from({ length: len }, () => Math.floor(Math.random() * 10)).join("");
}
