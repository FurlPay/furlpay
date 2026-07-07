import { NextRequest, NextResponse } from "next/server";

// Bearer-token gate for privileged compliance operations (source-of-funds
// attestations, escrow resolution, relayed settlement) that spend gas or write
// authoritative attestations. The token lives only in server env. If it is
// unset, these operations are disabled (fail closed) rather than open.
export function requireOperator(req: NextRequest): NextResponse | null {
  const token = process.env.FURLPAY_COMPLIANCE_OPERATOR_TOKEN;
  if (!token) {
    return NextResponse.json(
      { error: "operator actions disabled — FURLPAY_COMPLIANCE_OPERATOR_TOKEN not set" },
      { status: 403 },
    );
  }
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${token}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}
