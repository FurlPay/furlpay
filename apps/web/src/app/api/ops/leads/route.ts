import { NextRequest, NextResponse } from "next/server";
import { requireOpsAdmin, opsOk } from "@/lib/ops/respond";
import { rateLimitOr429 } from "@/lib/rateLimit";
import { audit } from "@/lib/audit";
import { listInteractions, listLeads, leadsDurable } from "@/lib/leads/store";

export const dynamic = "force-dynamic";

// GET /api/ops/leads — content lead analytics (ADMIN_ONLY).
// GET /api/ops/leads?format=csv — the export.
//
// ── TWO DIFFERENT DISCLOSURES ──────────────────────────────────────────────
//
// The default response is AGGREGATE: counts, top content, opt-in rate. No
// names, no email addresses. That is what a dashboard needs, and it means the
// common case never puts a contact list on the wire.
//
// `format=csv` is the export, and it is a materially bigger disclosure — every
// contact FurlPay holds, in one file. So it is separately rate-limited and it
// writes an audit entry naming the admin and the row count. Reading a
// dashboard and downloading the list are different acts and are recorded
// differently.
//
// ── WHAT NEVER APPEARS ─────────────────────────────────────────────────────
//
// No financial data. This is the marketing domain; revenue lives behind
// /api/ops/revenue and the two are not joined here. Also excluded from the
// CSV: consent IP (a GDPR record, not a mailing-list column) and anything
// from the account/auth systems.

const CSV_COLUMNS = [
  "Email",
  "First Name",
  "Last Name",
  "Company",
  "Job Title",
  "Country",
  "Email Type",
  "First Source",
  "Marketing Consent",
  "Created At",
] as const;

/** RFC 4180 escaping, plus formula-injection defence. */
function csvCell(value: string | boolean): string {
  let s = String(value ?? "");
  // A cell starting with = + - @ is executed as a formula by Excel and Sheets.
  // Prefixing a quote neutralises it without altering the stored data.
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET(req: NextRequest) {
  const auth = await requireOpsAdmin(req);
  if (!auth.ok) return auth.res;

  const csv = req.nextUrl.searchParams.get("format") === "csv";

  // The export is tighter than the dashboard read: it is the whole list.
  const limited = await rateLimitOr429(
    req,
    csv ? "ops.leads.export" : "ops.leads",
    csv ? { limit: 5, windowMs: 3_600_000 } : { limit: 60, windowMs: 60_000 },
  );
  if (limited) return limited;

  const [leads, interactions] = await Promise.all([listLeads(), listInteractions()]);

  if (csv) {
    const rows = leads.map((l) =>
      [
        l.email,
        l.firstName,
        l.lastName,
        l.company,
        l.jobTitle,
        l.country,
        l.emailType,
        l.firstSource,
        l.marketingConsent,
        l.createdAt,
      ]
        .map(csvCell)
        .join(","),
    );
    const body = [CSV_COLUMNS.join(","), ...rows].join("\r\n");

    // Who exported, when, and how many. The action that most needs a trail.
    audit("content.leads_exported", auth.account.user.id, { rows: leads.length });

    return new NextResponse(body, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="furlpay-content-leads.csv"`,
        // Never cached: it is a contact list.
        "Cache-Control": "no-store",
      },
    });
  }

  // ── Aggregates ───────────────────────────────────────────────────────────
  const downloads = interactions.filter((i) => i.eventType === "report_download");
  const registrations = interactions.filter((i) => i.eventType === "webinar_registration");

  const tally = (items: { contentId: string }[]) => {
    const counts = new Map<string, number>();
    for (const i of items) counts.set(i.contentId, (counts.get(i.contentId) ?? 0) + 1);
    return [...counts.entries()]
      .map(([contentId, count]) => ({ contentId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);
  };

  const companies = new Map<string, number>();
  for (const l of leads) {
    const key = l.company.trim();
    if (key) companies.set(key, (companies.get(key) ?? 0) + 1);
  }

  const since = Date.now() - 30 * 86_400_000;

  return opsOk({
    durable: leadsDurable(),
    totals: {
      leads: leads.length,
      newLast30Days: leads.filter((l) => Date.parse(l.createdAt) >= since).length,
      reportDownloads: downloads.length,
      webinarRegistrations: registrations.length,
      marketingOptIns: leads.filter((l) => l.marketingConsent).length,
      businessEmails: leads.filter((l) => l.emailType === "business").length,
    },
    bySource: {
      report_download: leads.filter((l) => l.firstSource === "report_download").length,
      webinar_registration: leads.filter((l) => l.firstSource === "webinar_registration").length,
    },
    topReports: tally(downloads),
    topWebinars: tally(registrations),
    // Company names only, with counts. No individuals.
    topCompanies: [...companies.entries()]
      .map(([company, count]) => ({ company, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10),
  });
}
