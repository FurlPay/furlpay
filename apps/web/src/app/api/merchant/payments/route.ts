import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { createLink, listMerchant, paymentDetail, setLinkActive, availableChains } from "@/lib/payments/merchant/repository";
import { linkSchema } from "@/lib/payments/merchant/model";
import { PAYMENT_CHAINS } from "@/lib/payments/merchant/registry";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store"};
const unavailable=()=>NextResponse.json({error:"Merchant payments are unavailable. Configure payment storage and apply migration 0040 before collecting funds."},{status:503,headers});
export async function GET(req:NextRequest) {
  const auth=await requireUser(req); if(!auth.ok) return auth.res;
  const limited=await rateLimitOr429(req,"merchant.read",{limit:90,windowMs:60000},auth.account.user.id); if(limited) return limited;
  const id=req.nextUrl.searchParams.get("id");
  if(id && !z.string().uuid().safeParse(id).success) return NextResponse.json({error:"Invalid payment ID"},{status:400,headers});
  try {
    if(id) { const detail=await paymentDetail(auth.account.user.id,id); return NextResponse.json(detail??{error:"Payment not found"},{status:detail?200:404,headers}); }
    const [data,readyChains]=await Promise.all([listMerchant(auth.account.user.id),availableChains(PAYMENT_CHAINS.map(c=>c.id),auth.account.user.id)]);
    return NextResponse.json({...data,readyChains,merchantName:auth.account.user.name},{headers});
  } catch { return unavailable(); }
}
export async function POST(req:NextRequest) {
  const auth=await requireUser(req); if(!auth.ok) return auth.res;
  const limited=await rateLimitOr429(req,"merchant.create",{limit:20,windowMs:60000},auth.account.user.id); if(limited) return limited;
  const input=await validateBody(req,linkSchema); if(input instanceof NextResponse) return input;
  if(input.expiresAt && Date.parse(input.expiresAt)<=Date.now()) return NextResponse.json({error:"Choose a future expiration"},{status:400,headers});
  try { return NextResponse.json({link:await createLink(auth.account.user.id,auth.account.user.name || "FurlPay merchant",input)},{status:201,headers}); }
  catch { return unavailable(); }
}
export async function PATCH(req:NextRequest) {
  const auth=await requireUser(req); if(!auth.ok) return auth.res;
  const limited=await rateLimitOr429(req,"merchant.update",{limit:20,windowMs:60000},auth.account.user.id); if(limited) return limited;
  const input=await validateBody(req,z.object({id:z.string().uuid(),active:z.boolean()}).strict()); if(input instanceof NextResponse) return input;
  try { const link=await setLinkActive(auth.account.user.id,input.id,input.active); return NextResponse.json(link?{link}:{error:"Link not found"},{status:link?200:404,headers}); }
  catch { return unavailable(); }
}
