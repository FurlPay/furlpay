import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { persistAccount } from "@/lib/store";
import {
  AVATAR_COLORS,
  contactErrorResponse,
  deleteContact,
  findContact,
  updateContact,
} from "@/lib/contacts";

export const dynamic = "force-dynamic";

/**
 * Whitelisted patch — AGENTS.md rule 4. `addresses`, `id`, `createdAt` and
 * `updatedAt` are deliberately absent: merging client JSON would let a caller
 * write an address that never passed the per-chain check, which is exactly the
 * unpayable-contact problem the address book exists to prevent. Addresses are
 * managed through their own endpoints.
 */
const PatchContactBody = z
  .object({
    name: z.string().trim().min(1).max(64).optional(),
    avatarColor: z.enum(AVATAR_COLORS).optional(),
    isFavorite: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: "No updatable fields supplied" });

// GET /api/contacts/:id
export async function GET(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(req, "contacts.get", { limit: 60, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  // Scoped to the caller's own account, so an id belonging to another user is
  // indistinguishable from one that does not exist.
  const contact = findContact(auth.account, (await props.params).id);
  if (!contact) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ contact });
}

// PATCH /api/contacts/:id — rename, recolour, favourite.
export async function PATCH(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(req, "contacts.update", { limit: 30, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  const body = await validateBody(req, PatchContactBody);
  if (body instanceof NextResponse) return body;

  const result = updateContact(auth.account, (await props.params).id, body);
  if (!result.ok) return contactErrorResponse(result.error);

  void persistAccount(auth.account.user.id);
  return NextResponse.json({ contact: result.value });
}

// DELETE /api/contacts/:id
export async function DELETE(req: NextRequest, props: { params: Promise<{ id: string }> }) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(req, "contacts.delete", { limit: 30, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  if (!deleteContact(auth.account, (await props.params).id)) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  void persistAccount(auth.account.user.id);
  return NextResponse.json({ ok: true });
}
