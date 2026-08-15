import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { persistAccount } from "@/lib/store";
import { contactErrorResponse, removeAddress, setDefaultAddress } from "@/lib/contacts";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string; addressId: string }> };

/** The only mutable field on a stored address. The address itself and its chain
 *  are immutable by design — "editing" one is removing it and adding the new
 *  one, so the replacement passes the same per-chain payability check. */
const PatchAddressBody = z.object({
  isDefault: z.literal(true),
});

// PATCH /api/contacts/:id/addresses/:addressId — make this the default address
// for its chain family (what the send sheet pre-selects).
export async function PATCH(req: NextRequest, props: Props) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(
    req,
    "contacts.address.update",
    { limit: 30, windowMs: 60_000 },
    auth.account.user.id
  );
  if (limited) return limited;

  const body = await validateBody(req, PatchAddressBody);
  if (body instanceof NextResponse) return body;

  const { id, addressId } = await props.params;
  const result = setDefaultAddress(auth.account, id, addressId);
  if (!result.ok) return contactErrorResponse(result.error);

  void persistAccount(auth.account.user.id);
  return NextResponse.json({ contact: result.value });
}

// DELETE /api/contacts/:id/addresses/:addressId
export async function DELETE(req: NextRequest, props: Props) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(
    req,
    "contacts.address.remove",
    { limit: 30, windowMs: 60_000 },
    auth.account.user.id
  );
  if (limited) return limited;

  const { id, addressId } = await props.params;
  const result = removeAddress(auth.account, id, addressId);
  if (!result.ok) return contactErrorResponse(result.error);

  void persistAccount(auth.account.user.id);
  return NextResponse.json({ contact: result.value });
}
