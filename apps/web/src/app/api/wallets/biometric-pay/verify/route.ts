import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { verifyBiometricPaymentAssertion } from "@/lib/biometrics/biometricPay";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

const VerifyAssertionSchema = z.object({
  challengeId: z.string().min(10).max(128),
  assertion: z.object({
    id: z.string(),
    rawId: z.string(),
    response: z.object({
      clientDataJSON: z.string(),
      authenticatorData: z.string(),
      signature: z.string(),
      userHandle: z.string().optional(),
    }),
    authenticatorAttachment: z.enum(["cross-platform", "platform"]).optional(),
    clientExtensionResults: z.record(z.any()).optional(),
    type: z.literal("public-key"),
  }),
});

export async function POST(req: NextRequest) {
  const limited = await rateLimitOr429(req, "wallets.biometric_pay.verify", {
    limit: 15,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const user = auth.account.user;

  const body = await validateBody(req, VerifyAssertionSchema);
  if (body instanceof NextResponse) return body;

  try {
    const result = await verifyBiometricPaymentAssertion(
      user.id,
      body.challengeId,
      body.assertion as any
    );

    audit("auth.mfa_enrolled" as any, user.id, {
      action: "biometric_pay.verified",
      proofId: result.proofId,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    audit("auth.mfa_failed", user.id, {
      action: "biometric_pay.failed",
      error: error?.message,
    });
    return NextResponse.json(
      { error: error?.message || "Biometric payment verification failed" },
      { status: 400 }
    );
  }
}
