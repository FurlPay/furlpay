import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/lib/authz";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { validateBody } from "@/lib/validate";
import { persistAccount } from "@/lib/store";
import {
  AVATAR_COLORS,
  CHAINS,
  MAX_ADDRESSES_PER_CONTACT,
  contactErrorResponse,
  contactsForChain,
  createContact,
  isContactChain,
  searchContacts,
} from "@/lib/contacts";

export const dynamic = "force-dynamic";

const AddressInput = z.object({
  // Bounded before any parsing: the per-chain check in lib/contacts.ts is the
  // real gate, this just stops a megabyte of text reaching it.
  address: z.string().trim().min(26).max(64),
  chain: z.enum(CHAINS),
  label: z.string().trim().max(40).optional(),
});

const CreateContactBody = z.object({
  name: z.string().trim().min(1).max(64),
  // Constrained to the palette because the value is interpolated into a style
  // attribute — an arbitrary string there is a rendering bug at best.
  avatarColor: z.enum(AVATAR_COLORS),
  addresses: z.array(AddressInput).max(MAX_ADDRESSES_PER_CONTACT).optional(),
});

// GET /api/contacts?chain=base&q=ali — the CALLER's address book.
// `chain` filters to contacts payable on that chain (and strips their addresses
// on other chains), which is what the send sheet wants: offering a contact whose
// only address is on another network invites the very mistake contacts prevent.
export async function GET(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(req, "contacts.list", { limit: 60, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  const chain = req.nextUrl.searchParams.get("chain");
  if (chain !== null && !isContactChain(chain)) {
    return NextResponse.json({ error: "invalid_chain", supported: CHAINS }, { status: 400 });
  }

  const query = req.nextUrl.searchParams.get("q") ?? "";
  const contacts = chain
    ? contactsForChain(auth.account, chain)
    : searchContacts(auth.account, query);

  // Search after chain-filtering so both parameters compose.
  const filtered =
    chain && query
      ? contacts.filter((c) => c.name.toLowerCase().includes(query.trim().toLowerCase()))
      : contacts;

  return NextResponse.json({ contacts: filtered });
}

// POST /api/contacts — create a contact.
export async function POST(req: NextRequest) {
  const auth = await requireUser(req);
  if (!auth.ok) return auth.res;

  const limited = await rateLimitOr429(req, "contacts.create", { limit: 30, windowMs: 60_000 }, auth.account.user.id);
  if (limited) return limited;

  const body = await validateBody(req, CreateContactBody);
  if (body instanceof NextResponse) return body;

  const result = createContact(auth.account, {
    name: body.name,
    avatarColor: body.avatarColor,
    addresses: body.addresses?.map((a) => ({
      address: a.address,
      chain: a.chain,
      ...(a.label ? { label: a.label } : {}),
    })),
  });
  if (!result.ok) return contactErrorResponse(result.error);

  void persistAccount(auth.account.user.id);
  return NextResponse.json({ contact: result.value }, { status: 201 });
}
