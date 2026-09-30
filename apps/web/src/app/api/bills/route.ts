import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { newTx, recordTransaction } from "@/lib/store";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { capabilityMode, capabilityUnavailable } from "@/lib/capabilityGate";

// GET /api/bills — the SESSION user's connected bills.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  return NextResponse.json({ bills: auth.account.bills });
}

// POST /api/bills — pay a bill, or toggle autopay.
// body: { id, action: "pay"|"toggleAutopay" }
//
// NOT LIVE. No biller network is integrated (BILL_PAY_LIVE is `unimplemented`
// in lib/flags.ts). "pay" used to zero the bill and record a SETTLED "On-chain
// bill pay · USDC" transaction without moving any money, and the body was not
// validated (AGENTS rule 1). Production now answers 503 for both actions —
// autopay included, because it is a standing instruction to pay. Outside
// production the simulation still runs, and says so on the transaction.
const Body = z
  .object({
    id: z.string().min(1).max(100),
    action: z.enum(["pay", "toggleAutopay"]),
  })
  .strip();

export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const mode = capabilityMode("BILL_PAY_LIVE");
  if (mode === null) return capabilityUnavailable("BILL_PAY_LIVE", "Bill pay");

  const limited = await rateLimitOr429(req, "bills.pay", { limit: 10, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  const body = await validateBody(req, Body);
  if (body instanceof NextResponse) return body;

  const bill = auth.account.bills.find((b) => b.id === body.id);
  if (!bill) return NextResponse.json({ error: "Bill not found" }, { status: 404 });

  if (body.action === "toggleAutopay") {
    bill.autopay = !bill.autopay;
    return NextResponse.json({ bill, simulated: mode === "simulated" });
  }

  // BILL_PAY_LIVE cannot be on (it is `unimplemented`), so this is only ever
  // reached in simulation. The day a biller rail exists, the live branch goes
  // here and the simulated one stays behind `mode === "simulated"`.
  const paid = bill.balanceDue;
  recordTransaction(
    auth.account.user.id,
    newTx({
      category: "bill",
      direction: "out",
      title: bill.provider,
      subtitle: "Simulated bill pay · no funds moved",
      amountUsd: paid,
      token: "USDC",
      status: "settled",
    })
  );
  bill.balanceDue = 0;
  return NextResponse.json({ bill, paid, simulated: true });
}
