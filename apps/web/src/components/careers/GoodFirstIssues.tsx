import { CircleDot } from "lucide-react";

// Live "good first issue" tracker — a merged PR is the strongest application
// we accept, so we surface the entry points right on the careers page.
// Server-rendered with hourly ISR; renders nothing on API failure or when no
// issues are open (an empty section is worse than no section).

interface Issue {
  title: string;
  html_url: string;
  number: number;
  labels: Array<{ name: string }>;
}

async function fetchIssues(): Promise<Issue[]> {
  try {
    const res = await fetch(
      "https://api.github.com/repos/Ashutosh0x/furlpay/issues?labels=good%20first%20issue&state=open&per_page=6",
      { headers: { Accept: "application/vnd.github+json" }, next: { revalidate: 3600 } },
    );
    if (!res.ok) return [];
    const json = await res.json();
    // The issues endpoint also returns PRs — filter them out.
    return (Array.isArray(json) ? json : []).filter((i: any) => !i.pull_request).slice(0, 6);
  } catch {
    return [];
  }
}

export default async function GoodFirstIssues() {
  const issues = await fetchIssues();
  if (!issues.length) return null;

  return (
    <section>
      <h2 className="mt-16 text-[24px] font-bold tracking-tighter">Open good-first-issues</h2>
      <p className="mt-2 max-w-2xl text-[14px] text-textSecondary">
        Close one of these and paste the PR link in your application — it fast-tracks you to the
        final round.
      </p>
      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        {issues.map((i) => (
          <a
            key={i.number}
            href={i.html_url}
            target="_blank"
            rel="noopener noreferrer"
            className="glass-card flex items-start gap-3 p-4 transition-colors hover:border-neon/30"
          >
            <CircleDot className="mt-0.5 h-4 w-4 shrink-0 text-neon" />
            <div>
              <p className="text-[13.5px] font-semibold leading-snug">{i.title}</p>
              <p className="mt-1 text-[12px] text-textMuted">#{i.number}</p>
            </div>
          </a>
        ))}
      </div>
    </section>
  );
}
