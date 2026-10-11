import { NextRequest,NextResponse } from "next/server";
import { requireCron } from "@/lib/cron/auth";
import { sbSelect } from "@/lib/supabase";
import { scanIntent } from "@/lib/payments/merchant/verifier";
import { deliverDue } from "@/lib/payments/merchant/webhooks";
import type { MerchantIntent } from "@/lib/payments/merchant/model";
export const dynamic="force-dynamic";
export const maxDuration=60;
/** Scheduler fallback; checkout polling uses the same verifier for lower latency. */
export async function GET(req:NextRequest) {
  const auth=requireCron(req); if(!auth.ok) return auth.res;
  try {
    const intents=await sbSelect<MerchantIntent>("merchant_payment_intents",`status=in.(awaiting_payment,confirming,underpaid,expired)&expires_at=gte.${encodeURIComponent(new Date(Date.now()-86400000).toISOString())}&order=last_checked_at.asc&limit=6`);
    let scanned=0,delayed=0;
    for(const intent of intents) { try { await scanIntent(intent); scanned++; } catch { delayed++; } }
    // Webhooks for payments credited by this or earlier passes (0041). A delivery
    // failure never fails the scan; it is retried on the outbox schedule.
    let webhooks: { delivered: number; failed: number } | { unavailable: true };
    try { const d=await deliverDue(20); webhooks={delivered:d.filter(x=>x.delivered).length,failed:d.filter(x=>!x.delivered).length}; }
    catch { webhooks={unavailable:true}; }
    return NextResponse.json({scanned,delayed,webhooks},{headers:{"Cache-Control":"no-store"}});
  } catch { return NextResponse.json({error:"Merchant scanner unavailable"},{status:503}); }
}
// The AWS scheduler POSTs (infra/aws/modules/env/scheduler.tf); Vercel Cron GETs.
export const POST = GET;
