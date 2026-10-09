import { NextRequest,NextResponse } from "next/server";
import { requireAnyRole,requireRole } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { applyOperation,operationSchema,operationsSnapshot } from "@/lib/payments/merchant/operations";
import { DestinationRejected } from "@/lib/payments/merchant/destinations";
export const dynamic="force-dynamic";
const headers={"Cache-Control":"no-store"};
const unavailable=()=>NextResponse.json({error:"Merchant operations are unavailable. Configure storage and apply migration 0042."},{status:503,headers});
/** Operator console: held payments, reconciliation alerts, pricing tiers. Records decisions; never moves money. */
export async function GET(req:NextRequest) {
  const auth=await requireAnyRole(req,["admin","compliance_officer"]); if(!auth.ok) return auth.res;
  const limited=await rateLimitOr429(req,"merchant.operations.read",{limit:60,windowMs:60000},auth.account.user.id); if(limited) return limited;
  try { return NextResponse.json(await operationsSnapshot(),{headers}); } catch { return unavailable(); }
}
export async function POST(req:NextRequest) {
  let auth=await requireAnyRole(req,["admin","compliance_officer"]); if(!auth.ok) return auth.res;
  const limited=await rateLimitOr429(req,"merchant.operations.write",{limit:30,windowMs:60000},auth.account.user.id); if(limited) return limited;
  const input=await validateBody(req,operationSchema); if(input instanceof NextResponse) return input;
  // Pricing and collection addresses change what merchants pay and where customers' money goes: admin only.
  // Notes and alert resolution: admin or compliance.
  if(input.action==="set_pricing"||input.action==="register_destination") { auth=await requireRole(req,"admin"); if(!auth.ok) return auth.res; }
  try {
    const out=await applyOperation(auth.account.user.id,input);
    return NextResponse.json(out?{result:out}:{error:input.action==="note"?"Payment not found":"Alert not found or already resolved"},{status:out?200:404,headers});
  } catch(e) {
    if(e instanceof DestinationRejected) return NextResponse.json({error:e.message},{status:422,headers});
    return unavailable();
  }
}
