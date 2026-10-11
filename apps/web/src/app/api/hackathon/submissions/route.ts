import { NextRequest, NextResponse } from "next/server";
import { readJsonBody } from "@/lib/validate";
import { z } from "zod";
import { parse } from "@/lib/schemas";
import { addSubmission, listSubmissions, isTrack, trackLabel, type TrackId } from "@/lib/hackathon";
import { sendEmail } from "@/lib/email";
import { rateLimitOr429 } from "@/lib/rateLimit";

export const dynamic = "force-dynamic";

// Public — the hackathon submission surface is unauthenticated by design.
// Optional http(s) URL: empty string is allowed (field is optional in the UI).
const OptionalUrl = z
  .string()
  .trim()
  .max(300)
  .refine((v) => v === "" || /^https?:\/\/\S+$/i.test(v), "Must be a valid http(s) URL")
  .optional();

const SubmissionSchema = z.object({
  projectName: z.string().trim().min(2).max(80),
  teamName: z.string().trim().min(2).max(80),
  email: z.string().trim().email().max(160),
  track: z.enum(["agentic", "consumer", "infra", "wildcard"]),
  oneLiner: z.string().trim().min(10).max(120),
  description: z.string().trim().min(20).max(600),
  repoUrl: OptionalUrl,
  demoUrl: OptionalUrl,
  chain: z.string().trim().max(40).optional(),
});

// GET /api/hackathon/submissions?track=agentic — public gallery feed (no emails).
export function GET(req: NextRequest) {
  const t = req.nextUrl.searchParams.get("track");
  const track: TrackId | undefined = isTrack(t) ? t : undefined;
  return NextResponse.json({ submissions: listSubmissions(track) });
}

// POST /api/hackathon/submissions — submit a project to the Build Challenge.
export async function POST(req: NextRequest) {
  // Public form that sends an email per submission — throttle spam.
  const limited = await rateLimitOr429(req, "hackathon.submissions", { limit: 5, windowMs: 60_000 });
  if (limited) return limited;

  const parsed = parse(SubmissionSchema, await readJsonBody(req).catch(() => ({})));
  if (!parsed.ok) return parsed.res;
  const d = parsed.data;

  const entry = addSubmission({
    projectName: d.projectName,
    teamName: d.teamName,
    email: d.email,
    track: d.track,
    oneLiner: d.oneLiner,
    description: d.description,
    repoUrl: d.repoUrl || undefined,
    demoUrl: d.demoUrl || undefined,
    chain: d.chain || undefined,
  });

  // Notify the team (mock-safe: logs to console without RESEND configured).
  void sendEmail({
    to: process.env.HACKATHON_INBOX || process.env.CONTACT_INBOX || "hello@furlpay.com",
    replyTo: d.email,
    subject: `Build Challenge submission: ${d.projectName} · ${trackLabel(d.track)}`,
    html: `<p><b>${d.projectName}</b> by ${d.teamName} (${d.email})</p><p>${d.oneLiner}</p><p>${d.description}</p>${
      d.repoUrl ? `<p>Repo: ${d.repoUrl}</p>` : ""
    }${d.demoUrl ? `<p>Demo: ${d.demoUrl}</p>` : ""}`,
    text: `${d.projectName} by ${d.teamName} <${d.email}> · ${trackLabel(d.track)}\n${d.oneLiner}\n\n${d.description}\n${d.repoUrl ?? ""} ${d.demoUrl ?? ""}`,
  });
  console.log(`[hackathon] submission: ${d.projectName} (${d.teamName}) · ${d.track}`);

  // Return the sanitized public record so the UI can show it immediately.
  return NextResponse.json(
    {
      ok: true,
      submission: {
        id: entry.id,
        projectName: entry.projectName,
        teamName: entry.teamName,
        track: entry.track,
        oneLiner: entry.oneLiner,
        description: entry.description,
        repoUrl: entry.repoUrl,
        demoUrl: entry.demoUrl,
        chain: entry.chain,
        at: entry.at,
      },
    },
    { status: 201 }
  );
}
