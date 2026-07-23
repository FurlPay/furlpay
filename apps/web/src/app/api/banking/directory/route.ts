import { NextRequest, NextResponse } from "next/server";
import { getHkBranches, getHkAtms } from "@/lib/hkma";
import { rateLimitOr429 } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

/**
 * GET /api/banking/directory?type=branches|atms|all&bank=&district=&limit=
 *
 * Vendor-neutral bank directory for Hong Kong, sourced from the HKMA's public
 * open-data API. This replaced /api/banking/hsbc, which was named for one
 * institution and served hardcoded data for seven of its eight "modules"; that
 * route and its client were deleted on 23 Jul 2026 rather than left in the tree
 * to be found and trusted later.
 *
 * WHY NEUTRAL NAMING. FurlPay is a payment layer, not a bank front-end. A route
 * named for an institution asserts a relationship with it, and this data covers
 * 20 licensed banks from the regulator — strictly more than any single bank
 * could provide. Institutions are named FACTUALLY in the payload (as the values
 * of a `bankName` field) and never promotionally.
 *
 * WHY NOT lib/rails/registry.ts. That registry describes payment rails —
 * protocol, chains, fee model, per-transaction cap — and its own header warns
 * against wrapping unlike things in a common interface. A branch locator has no
 * protocol and moves no money. It is reference data and lives on its own route.
 *
 * LIVE, verified 22 Jul 2026: 200 OK, header.success true, 1,051 branch records
 * across 20 banks. No credentials, no partnership, no approval.
 *
 * FAILS CLOSED. On upstream failure this returns 502 with the error, never an
 * empty list that a caller could read as "no branches near you". The mocked FX
 * rates that prompted this route existed precisely because a silent fallback
 * was indistinguishable from success.
 *
 * ATTRIBUTION IS MANDATORY, NOT COSMETIC. HKMA's terms require attribution and
 * restrict COMMERCIAL use absent specific permission. The `attribution` field
 * is returned on every response and must be surfaced by any UI that renders
 * this data. Commercial clearance is still outstanding — see the note below.
 */

/** Non-negotiable per HKMA terms of use. */
const ATTRIBUTION = {
  source: "Hong Kong Monetary Authority (HKMA) Public Open Data API",
  url: "https://apidocs.hkma.gov.hk/",
  notice: "Bank branch and ATM data © Hong Kong Monetary Authority.",
  /* HKMA permits non-commercial use with attribution; commercial use requires
     specific permission. Surfaced in the payload so the state is visible to
     anyone integrating rather than buried in a comment. */
  commercialUseCleared: false,
} as const;

const TYPES = new Set(["branches", "atms", "all"]);
const MAX_LIMIT = 500;

export async function GET(req: NextRequest) {
  // Public, unauthenticated route: AGENTS.md rule 2. Upstream is a government
  // API with its own limits, and the 6h cache means most hits never leave us.
  const limited = await rateLimitOr429(req, "banking-directory", { limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const { searchParams } = new URL(req.url);

  const type = searchParams.get("type") || "all";
  if (!TYPES.has(type)) {
    return NextResponse.json(
      { success: false, error: `type must be one of ${[...TYPES].join(", ")}` },
      { status: 400 }
    );
  }

  /* Bounded, trimmed, and length-capped: these reach an upstream we do not own,
     and an unbounded substring is a cheap way to make it do work for us. */
  const bank = (searchParams.get("bank") || "").trim().slice(0, 80) || undefined;
  const district = (searchParams.get("district") || "").trim().slice(0, 40) || undefined;

  const rawLimit = Number(searchParams.get("limit"));
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), MAX_LIMIT) : MAX_LIMIT;

  try {
    const wantBranches = type === "branches" || type === "all";
    const wantAtms = type === "atms" || type === "all";

    const [branches, atms] = await Promise.all([
      wantBranches ? getHkBranches({ bank, district }) : Promise.resolve(null),
      wantAtms ? getHkAtms({ bank, district }) : Promise.resolve(null),
    ]);

    // Upstream failure is an error, not an empty result.
    const failure = branches?.error || atms?.error;
    if (failure) {
      return NextResponse.json(
        { success: false, error: failure, attribution: ATTRIBUTION },
        { status: 502 }
      );
    }

    return NextResponse.json({
      success: true,
      source: "hkma_live",
      fetchedAt: branches?.fetchedAt ?? atms?.fetchedAt ?? new Date().toISOString(),
      query: { type, bank: bank ?? null, district: district ?? null, limit },
      branches: branches
        ? { total: branches.records.length, records: branches.records.slice(0, limit) }
        : undefined,
      atms: atms
        ? { total: atms.records.length, records: atms.records.slice(0, limit) }
        : undefined,
      attribution: ATTRIBUTION,
    });
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error: err instanceof Error ? err.message : "bank directory unavailable",
        attribution: ATTRIBUTION,
      },
      { status: 502 }
    );
  }
}
