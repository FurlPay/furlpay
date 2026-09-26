import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { verifyActionStepUpAssertion } from "@/lib/biometrics/actionProof";
import { audit } from "@/lib/audit";

export const dynamic = "force-dynamic";

// POST /api/actions/step-up/verify
//
// Step 2. Verifies the WebAuthn assertion against the challenge minted by
// /api/actions/step-up/challenge and returns a single-use proofId valid for 120
// seconds. The executing route consumes it and checks it against the request it
// actually receives.

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
  // Lower than the challenge limit. Each verify attempt is a signature check
  // against a challenge that is burned on read, so a legitimate client makes one
  // per approval; a client making fifteen a minute is guessing.
  const limited = await rateLimitOr429(req, "actions.step_up.verify", {
    limit: 15,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;
  const userId = auth.account.user.id;

  const body = await validateBody(req, VerifyAssertionSchema);
  if (body instanceof NextResponse) return body;

  try {
    const result = await verifyActionStepUpAssertion(
      userId,
      body.challengeId,
      body.assertion as never
    );
    return NextResponse.json(result);
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Step-up verification failed";
    audit("auth.mfa_failed", userId, { action: "action.step_up_verify", reason });
    // 401, not 400. A failed assertion is an authentication outcome, and the
    // client distinguishes "retry the ceremony" from "your request was malformed"
    // by the status.
    return NextResponse.json({ error: reason }, { status: 401 });
  }
}
