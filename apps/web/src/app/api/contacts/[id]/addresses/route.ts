import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { persistAccount } from "@/lib/store";
import { CHAINS, addAddress, contactErrorResponse, findContact } from "@/lib/contacts";

export const dynamic = "force-dynamic";

/**
 * Addresses are added through their own endpoint rather than as a field on
 * PATCH /api/contacts/:id — the per-chain payability check in lib/contacts.ts
 * is the whole point of the address book, and a patchable `addresses` array is
 * a mass-assignment hole straight past it (AGENTS.md rule 4).
 */
const AddAddressBody = z.object({
  // Bounded before parsing: classifyAddress is the real gate, this just keeps a
  // megabyte of text from reaching the base58 decoder.
  address: z.string().trim().min(26).max(64),
  chain: z.enum(CHAINS),
  label: z.string().trim().max(40).optional(),
});

// POST /api/contacts/:id/addresses — add one address to a contact.
export async function POST(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(
    req,
    "contacts.address.add",
    { limit: 30, windowMs: 60_000 },
    auth.account.user.id
  );
  if (limited) return limited;

  const body = await validateBody(req, AddAddressBody);
  if (body instanceof NextResponse) return body;

  const result = addAddress(auth.account, (await props.params).id, {
    address: body.address,
    chain: body.chain,
    ...(body.label ? { label: body.label } : {}),
  });
  if (!result.ok) return contactErrorResponse(result.error);

  void persistAccount(auth.account.user.id);
  // The whole contact, not just the new address: adding the first address makes
  // it the default, and the caller needs the updated list to render that.
  return NextResponse.json(
    { address: result.value, contact: findContact(auth.account, (await props.params).id) },
    { status: 201 }
  );
}
