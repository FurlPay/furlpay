import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { getLink,getIntent,reserveIntent,availableChains } from "@/lib/payments/merchant/repository";
import { checkoutSchema,publicIntent,publicLink } from "@/lib/payments/merchant/model";
import { scanIntent } from "@/lib/payments/merchant/verifier";
import { paymentUri } from "@/lib/payments/merchant/qr";
export const dynamic="force-dynamic";
export const maxDuration=60;
const headers={"Cache-Control":"no-store", "Referrer-Policy":"no-referrer"};
type Context={params:Promise<{slug:string}>};
const validSlug=(slug:string)=>/^[A-Za-z0-9_-]{24}$/.test(slug);
export async function GET(req:NextRequest,ctx:Context) {
  const limited=await rateLimitOr429(req,"merchant.checkout.read",{limit:90,windowMs:60000}); if(limited) return limited;
  const {slug}=await ctx.params;
  if(!validSlug(slug)) return NextResponse.json({error:"Payment link not found"},{status:404,headers});
  const id=req.nextUrl.searchParams.get("intent");
  if(id && !z.string().uuid().safeParse(id).success) return NextResponse.json({error:"Invalid checkout ID"},{status:400,headers});
  try {
    const link=await getLink(slug);
    if(!link) return NextResponse.json({error:"Payment link not found"},{status:404,headers});
    if(!id) return NextResponse.json({link:publicLink(link),readyChains:await availableChains(link.chains,link.merchant_id)},{headers});
    let intent=await getIntent(id,link.id);
    if(!intent) return NextResponse.json({error:"Checkout not found"},{status:404,headers});
    let verificationDelayed=false;
    // A node outage never fabricates failure or success. Keep the last proven
    // state and tell the payer that verification is delayed.
    if(!["paid","overpaid","review"].includes(intent.status)) {
      try { intent=await scanIntent(intent); } catch { verificationDelayed=true; }
    }
    const remaining=BigInt(intent.charge_units)-BigInt(intent.received_units);
    return NextResponse.json({intent:publicIntent(intent),verificationDelayed,uri:remaining>0n && Date.parse(intent.expires_at)>Date.now() && intent.status!=="review" ? paymentUri(intent.chain,intent.recipient,remaining.toString(),intent.reference):null},{headers});
  } catch { return NextResponse.json({error:"This checkout is temporarily unavailable. Please try again."},{status:503,headers}); }
}
export async function POST(req:NextRequest,ctx:Context) {
  const limited=await rateLimitOr429(req,"merchant.checkout.reserve",{limit:10,windowMs:60000}); if(limited) return limited;
  const {slug}=await ctx.params;
  if(!validSlug(slug)) return NextResponse.json({error:"Payment link not found"},{status:404,headers});
  const input=await validateBody(req,checkoutSchema); if(input instanceof NextResponse) return input;
  try {
    const intent=await reserveIntent(slug,input.requestId,input.chain);
    return NextResponse.json({intent:publicIntent(intent),uri:paymentUri(intent.chain,intent.recipient,intent.charge_units,intent.reference)},{status:201,headers});
  } catch(error) {
    const reason=error instanceof Error?error.message:"";
    if(/link_unavailable|checkout_in_progress|request_conflict/.test(reason)) return NextResponse.json({error:"This payment link is closed, or a single-use checkout is already in progress."},{status:409,headers});
    return NextResponse.json({error:"This network is not ready to receive payments. No payment has been requested. Try again later."},{status:503,headers});
  }
}
