import { NextRequest, NextResponse } from "next/server";
import { createPayment } from "@/lib/services/payments";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { z } from "zod";
import { listContractors } from "@/lib/payroll/repository";
import { displayUsdc } from "@/lib/payments/merchant/money";

export const dynamic = "force-dynamic";

// Stablecoin payroll / contractor disbursement. Pay a whole team in USDC in one
// run — each line becomes a payment intent (settled as one FurlPayRouter batch
// on-chain, ~45% cheaper than sequential transfers). FurlPay angle: the same
// account that runs payroll also books the team's travel, so a remote-team
// operator does both in one product.
//
// GET  → the caller's saved roster (payroll_contractors, migration 0042; managed
//        at /api/payouts/payroll/contractors). Storage not configured → empty,
//        with persisted:false. Never a placeholder roster — see below.
// POST → run payroll for the roster IN THE BODY; returns per-line intents plus
//        totals. Money only moves once each intent's sign data is signed.
//
// SECURITY HISTORY. A "saved demo roster" of three people at the placeholder
// addresses 0x1111…, 0x2222… and 0x3333… used to be served by GET (to anyone,
// unauthenticated) and used by POST whenever `employees` was omitted. That
// fallback produced real, signable USDC payment intents totalling $12,900 to
// addresses nobody at FurlPay controls: one tap on "Run payroll" plus a
// signature would have sent a customer's money to them. `employees` is now
// required, and there is no roster to fall back to.

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
  // Required. Every recipient of a payroll run must come from the caller.
  employees: z.array(Employee).min(1).max(100),
});

export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  let saved;
  try { saved = await listContractors(auth.account.user.id); }
  catch { return NextResponse.json({ roster: [], headcount: 0, monthlyUsd: 0, persisted: false }); }
  const active = saved.filter((c) => c.active);
  const monthlyUnits = active.reduce((s, c) => s + BigInt(String(c.default_amount_units)), 0n);
  return NextResponse.json({
    roster: active.map((c) => ({ id: c.id, name: c.name, role: c.role, address: c.payout_address, chain: c.payout_chain, amountUsdc: displayUsdc(BigInt(String(c.default_amount_units))) })),
    headcount: active.length,
    monthlyUsd: Number(displayUsdc(monthlyUnits)),
    persisted: true,
  });
}

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(req, "payouts.payroll", { limit: 5, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  const parsed = RunSchema.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? "invalid_body" }, { status: 400 });
  }
  const sourceChain = parsed.data.sourceChain ?? "arbitrum";
  const cycle = parsed.data.cycle ?? new Date().toISOString().slice(0, 7);
  const employees = parsed.data.employees;

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
