import { NextRequest,NextResponse } from "next/server";
import { requireCron } from "@/lib/cron/auth";
import { reconcile } from "@/lib/payments/merchant/reconcile";
import { reconcilePayroll } from "@/lib/payroll/reconcile";
export const dynamic="force-dynamic";
export const maxDuration=60;
/** Every 10 minutes: intent vs receipts vs ledger (SQL) and receipts vs chain, then payroll fees vs executions vs chain. Records alerts only. */
export async function GET(req:NextRequest) {
  const auth=requireCron(req); if(!auth.ok) return auth.res;
  try {
    const merchant = await reconcile();
    // Payroll (0048) runs in the same job; a deployment without payroll storage reports that instead of failing the merchant pass.
    const payroll = await reconcilePayroll().catch((e: unknown) => ({ unavailable: (e instanceof Error ? e.message : "error").slice(0, 120) }));
    return NextResponse.json({ ...merchant, payroll },{headers:{"Cache-Control":"no-store"}});
  }
  catch { return NextResponse.json({error:"Merchant reconciliation unavailable"},{status:503}); }
}
// The AWS scheduler POSTs (infra/aws/modules/env/scheduler.tf); Vercel Cron GETs.
export const POST = GET;
