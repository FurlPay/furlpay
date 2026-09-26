import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { createBiometricPaymentChallenge } from "@/lib/biometrics/biometricPay";

export const dynamic = "force-dynamic";

const ChallengeRequestSchema = z.object({
  amount: z.number().positive().max(10_000_000), // Max $10M per transfer cap
  asset: z.string().min(2).max(32),
  recipient: z.string().min(4).max(128),
  chain: z.string().min(2).max(32),
});

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "wallets.biometric_pay.challenge", {
    limit: 20,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const user = auth.account.user;

  const body = await validateBody(req, ChallengeRequestSchema);
  if (body instanceof NextResponse) return body;

  try {
    const result = await createBiometricPaymentChallenge({
      userId: user.id,
      amount: body.amount,
      asset: body.asset,
      recipient: body.recipient,
      chain: body.chain,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    return NextResponse.json(
      { error: error?.message || "Failed to generate biometric challenge" },
      { status: 400 }
    );
  }
}
