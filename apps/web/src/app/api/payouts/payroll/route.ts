import { NextRequest, NextResponse } from "next/server";
import { createPayment } from "@/lib/services/payments";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { z } from "zod";

export const dynamic = "force-dynamic";

// Stablecoin payroll / contractor disbursement. Pay a whole team in USDC in one
// run — each line becomes a payment intent (settled as one FurlPayRouter batch
// on-chain, ~45% cheaper than sequential transfers). FurlPay angle: the same
// account that runs payroll also books the team's travel, so a remote-team
// operator does both in one product.
//
// GET  → the saved roster (demo).
// POST → run payroll for the given (or saved) roster; returns per-line intents
//        plus totals. Money only moves once each intent's sign data is signed.

const EvmAddress = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "invalid address");

const Employee = z.object({
  name: z.string().min(1).max(80),
  address: EvmAddress,
  amountUsd: z.number().positive().max(1_000_000),
  role: z.string().max(80).optional(),
});

const RunSchema = z.object({
  sourceChain: z.enum(["arbitrum", "base", "polygon"]).optional(),
  cycle: z.string().max(40).optional(), // e.g. "2026-07" or "weekly"
  employees: z.array(Employee).min(1).max(100).optional(),
});

// Saved demo roster.
const ROSTER: z.infer<typeof Employee>[] = [
  { name: "Aisha Rahman", address: "0x1111111111111111111111111111111111111111", amountUsd: 5200, role: "Engineer (NL)" },
  { name: "Diego Santos", address: "0x2222222222222222222222222222222222222222", amountUsd: 4100, role: "Designer (BR)" },
  { name: "Mei Lin", address: "0x3333333333333333333333333333333333333333", amountUsd: 3600, role: "Contractor (SG)" },
];

export function GET() {
  const monthly = ROSTER.reduce((s, e) => s + e.amountUsd, 0);
  return NextResponse.json({ roster: ROSTER, headcount: ROSTER.length, monthlyUsd: monthly });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = rateLimitOr429(req, "payouts.payroll", { limit: 5, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  const parsed = RunSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid_body" }, { status: 400 });
  }
  const sourceChain = parsed.data.sourceChain ?? "arbitrum";
  const cycle = parsed.data.cycle ?? new Date().toISOString().slice(0, 7);
  const employees = parsed.data.employees ?? ROSTER;

  const created = await Promise.all(
    employees.map((e) =>
      createPayment({
        amount: e.amountUsd,
        sourceChain,
        recipient: e.address,
        metadata: { kind: "payroll", cycle, name: e.name, ...(e.role ? { role: e.role } : {}) },
        userId: auth.account.user.id,
      }),
    ),
  );

  const totalNet = created.reduce((s, c) => s + c.record.amountUsdc, 0);
  const totalFees = created.reduce((s, c) => s + c.record.feeUsdc, 0);

  return NextResponse.json(
    {
      cycle,
      sourceChain,
      headcount: created.length,
      totalNetUsdc: totalNet.toFixed(2),
      totalFeesUsdc: totalFees.toFixed(2),
      lines: created.map((c, i) => ({
        name: employees[i].name,
        role: employees[i].role,
        recipient: c.record.recipient,
        amountUsdc: c.record.amountUsdc.toFixed(2),
        feeUsdc: c.record.feeUsdc.toFixed(2),
        paymentId: c.record.id,
        signData: c.signData,
      })),
    },
    { status: 201 },
  );
}
