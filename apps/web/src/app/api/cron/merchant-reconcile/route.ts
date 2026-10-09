import { NextRequest,NextResponse } from "next/server";
import { requireCron } from "@/lib/cron/auth";
import { reconcile } from "@/lib/payments/merchant/reconcile";
export const dynamic="force-dynamic";
export const maxDuration=60;
/** Every 10 minutes: intent vs receipts vs ledger (SQL) and receipts vs chain. Records alerts only. */
export async function GET(req:NextRequest) {
  const auth=requireCron(req); if(!auth.ok) return auth.res;
  try { return NextResponse.json(await reconcile(),{headers:{"Cache-Control":"no-store"}}); }
  catch { return NextResponse.json({error:"Merchant reconciliation unavailable"},{status:503}); }
}
// The AWS scheduler POSTs (infra/aws/modules/env/scheduler.tf); Vercel Cron GETs.
export const POST = GET;
