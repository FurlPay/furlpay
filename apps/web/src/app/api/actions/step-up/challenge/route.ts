import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { createActionStepUpChallenge } from "@/lib/biometrics/actionProof";
import { STEP_UP_ENDPOINTS } from "@/lib/biometrics/stepUpEndpoints";

export const dynamic = "force-dynamic";

// POST /api/actions/step-up/challenge
//
// Step 1 of the action-bound biometric step-up. The client declares the exact
// request it intends to send; the server mints a WebAuthn challenge committed to
// that request and remembers the digest.
//
// A declared intent is NOT trusted, and does not need to be. The proof minted
// here is only accepted by the executing route if the request it actually
// receives re-derives the same digest — so declaring something harmless and
// sending something else yields a proof that fails to validate. The declaration
// decides what the user is asked to approve, not what they are allowed to do.

/**
 * A JSON body of bounded depth.
 *
 * Recursion is capped rather than left to `z.lazy` running to the stack limit:
 * this endpoint takes attacker-shaped JSON, and "deeply nested object" is the
 * cheapest way to turn a validator into a denial of service. `validateBody`
 * caps the payload at 100KB, and this caps the shape.
 */
const JsonLeaf = z.union([z.string(), z.number().finite(), z.boolean(), z.null()]);
const Json2: z.ZodType = z.union([JsonLeaf, z.array(JsonLeaf), z.record(JsonLeaf)]);
const Json1: z.ZodType = z.union([JsonLeaf, z.array(Json2), z.record(Json2)]);
const JsonBody = z.record(Json1);

const ChallengeRequestSchema = z.object({
  // Constrained to the endpoints that actually enforce step-up. Minting a proof
  // for an arbitrary string would never authorise anything — validation compares
  // against the executing route — but it would let anyone fill the challenge
  // store with entries, so the allowlist is a cost control as much as a check.
  endpoint: z.enum(STEP_UP_ENDPOINTS),
  method: z.enum(["POST", "PUT", "PATCH", "DELETE", "post", "put", "patch", "delete"]),
  body: JsonBody,
});

export async function POST(req: NextRequest) {
  // Tighter than the middleware baseline. A challenge is cheap for the client and
  // costs the server a WebAuthn options generation plus two KV writes, and there
  // is no legitimate flow that needs more than a handful a minute.
  const limited = await rateLimitOr429(req, "actions.step_up.challenge", {
    limit: 20,
    windowMs: 60_000,
  });
  if (limited) return limited;

  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const body = await validateBody(req, ChallengeRequestSchema);
  if (body instanceof NextResponse) return body;

  try {
    const result = await createActionStepUpChallenge({
      userId: auth.account.user.id,
      endpoint: body.endpoint,
      method: body.method,
      body: body.body as Record<string, never>,
    });
    return NextResponse.json(result);
  } catch (error) {
    // The expected failure is "no passkeys registered", which is a 400 the client
    // can act on by sending the user to passkey registration.
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to generate step-up challenge" },
      { status: 400 }
    );
  }
}
