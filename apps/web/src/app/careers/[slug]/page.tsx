import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, MapPin, Briefcase, Wallet, Percent } from "lucide-react";
import LandingChrome from "@/components/landing/LandingChrome";
import CareersForm from "@/components/marketing/CareersForm";
import { JOBS, getJob, jobPostingJsonLd } from "@/lib/careers/jobs";

// One crawlable URL per role. JobPosting JSON-LD is emitted ONLY for roles
// with status "open" — upcoming roles get a public page and a pipeline form,
// but never a Google for Jobs listing (bait listings carry an SEO penalty
// and cost candidate trust).

export function generateStaticParams() {
  return JOBS.filter((j) => j.status !== "closed").map((j) => ({ slug: j.slug }));
}

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const params = await props.params;
  const job = getJob(params.slug);
  if (!job) return {};
  const openness = job.status === "open" ? "Now hiring" : "Opening after our pre-seed";
  return {
    title: `${job.title} — Careers`,
    description: `${openness}: ${job.title} at Furlpay. ${job.team} · ${job.location} · $${(job.salaryMinUsd / 1000).toFixed(0)}K–$${(job.salaryMaxUsd / 1000).toFixed(0)}K + ${job.equityBand} equity.`,
    alternates: { canonical: `/careers/${job.slug}` },
    openGraph: {
      title: `${job.title} — Furlpay Careers`,
      description: job.summary,
      type: "website",
      url: `https://furlpay.com/careers/${job.slug}`,
    },
  };
}

export default async function JobPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  const job = getJob(params.slug);
  if (!job || job.status === "closed") notFound();

  const salary = `$${job.salaryMinUsd.toLocaleString()}–$${job.salaryMaxUsd.toLocaleString()} USD / yr`;

  return (
    <div className="min-h-screen bg-oled">
      <LandingChrome />
      <main className="mx-auto max-w-3xl px-6 pb-24 pt-14">
        {job.status === "open" && (
          <JsonLd data={jobPostingJsonLd(job)} />
        )}

        <Link
          href="/careers"
          className="mb-6 inline-flex items-center gap-1 text-sm text-textSecondary hover:text-white"
        >
          <ChevronLeft className="h-4 w-4" /> All roles
        </Link>

        <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.18em] text-neon">{job.team}</p>
        <h1 className="text-[36px] font-extrabold leading-tight tracking-tighter sm:text-[44px]">{job.title}</h1>

        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-[13.5px] text-textSecondary">
          <span className="flex items-center gap-1.5"><MapPin className="h-4 w-4 text-neon" /> {job.location}</span>
          <span className="flex items-center gap-1.5"><Briefcase className="h-4 w-4 text-neon" /> {job.employmentType === "FULL_TIME" ? "Full-time" : "Contract"}</span>
          <span className="flex items-center gap-1.5"><Wallet className="h-4 w-4 text-neon" /> {salary}</span>
          <span className="flex items-center gap-1.5"><Percent className="h-4 w-4 text-neon" /> {job.equityBand} equity</span>
        </div>

        {job.status === "upcoming" && (
          <div className="mt-8 glow-border p-5">
            <p className="text-[14px] font-bold text-neon">This role opens after our pre-seed round.</p>
            <p className="mt-1 text-[13.5px] leading-relaxed text-textMuted">
              Everything below — scope, salary band, equity — is real and current. Join the pipeline
              at the bottom and you will hear from us first, before the role is ever posted publicly.
            </p>
          </div>
        )}

        <p className="mt-8 text-[16px] leading-relaxed text-textMuted">{job.summary}</p>

        <h2 className="mt-12 text-[20px] font-bold tracking-tighter">What you will own</h2>
        <ul className="mt-4 space-y-2.5">
          {job.responsibilities.map((r) => (
            <li key={r} className="flex gap-2.5 text-[14.5px] leading-relaxed text-textMuted">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-neon/70" /> {r}
            </li>
          ))}
        </ul>

        <h2 className="mt-10 text-[20px] font-bold tracking-tighter">What we need to see</h2>
        <ul className="mt-4 space-y-2.5">
          {job.requirements.map((r) => (
            <li key={r} className="flex gap-2.5 text-[14.5px] leading-relaxed text-textMuted">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-neon/70" /> {r}
            </li>
          ))}
        </ul>

        {job.niceToHave.length > 0 && (
          <>
            <h2 className="mt-10 text-[20px] font-bold tracking-tighter">Nice to have</h2>
            <ul className="mt-4 space-y-2.5">
              {job.niceToHave.map((r) => (
                <li key={r} className="flex gap-2.5 text-[14.5px] leading-relaxed text-textMuted">
                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-white/25" /> {r}
                </li>
              ))}
            </ul>
          </>
        )}

        <div className="mt-14 grid grid-cols-1 gap-8 lg:grid-cols-2">
          <div>
            <h2 className="text-[24px] font-extrabold tracking-tighter">
              {job.status === "open" ? "Apply now" : "Be first in line"}
            </h2>
            <p className="mt-3 text-[14.5px] leading-relaxed text-textSecondary">
              A merged PR into{" "}
              <a href="https://github.com/Ashutosh0x/furlpay" className="text-neon hover:underline">
                our open-source repos
              </a>{" "}
              fast-tracks you to the final round. No whiteboard puzzles; under two weeks from
              application to decision.
            </p>
          </div>
          <CareersForm defaultRole={job.title} />
        </div>
      </main>
    </div>
  );
}
