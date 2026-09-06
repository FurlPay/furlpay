import Link from "next/link";
import { getAuthor, authorSlug } from "@/lib/blog/authors";

// Visible author box for articles — the human-facing half of E-E-A-T. Pairs
// with the Person/Organization node emitted into the article's JSON-LD.
export default function AuthorBio({ author }: { author: string }) {
  const a = getAuthor(author);
  const monogram = a.name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("");

  return (
    <div className="mt-12 flex gap-4 rounded-2xl border border-white/10 bg-white/[0.02] p-5">
      {a.avatar ? (
        // The size classes here were h-13/w-13, which do not exist in
        // Tailwind's scale (it runs 12, 14) and so were never generated. With
        // no CSS height, the image took its height from the flex row's default
        // align-items: stretch and grew to the full height of the bio text,
        // rendering as a tall ellipse showing a vertical sliver of the
        // photograph. h-14/w-14 are real, and an explicit height also stops
        // the stretch regardless.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={a.avatar}
          alt={a.name}
          width={56}
          height={56}
          loading="lazy"
          className="h-14 w-14 shrink-0 self-start rounded-full border border-white/10 object-cover"
        />
      ) : (
        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-neon/30 bg-neon/10 text-[15px] font-bold text-neon">
          {monogram}
        </div>
      )}
      <div className="min-w-0">
        {/* Linked, not plain text: the Person entity needs an internal path
            pointing at it or the credentials below never accumulate anywhere. */}
        <p className="text-[15px] font-bold">
          <Link href={`/blog/author/${authorSlug(a.name)}`} className="transition-colors hover:text-neon">
            {a.name}
          </Link>
        </p>
        <p className="text-[12px] text-textMuted">
          {a.role}
          {a.credentials ? ` · ${a.credentials}` : ""}
        </p>
        <p className="mt-2 text-[13px] leading-relaxed text-textSecondary">{a.bio}</p>
        {/* An internal link to the entity home, on every article that carries
            this byline. Google forms a person entity from the pages that point
            at it with a consistent name; a byline that links only to a
            per-author archive gives it nothing to point AT. External profile
            links below are `rel="author"` but leave the site. */}
        {a.isPerson && a.url?.startsWith("https://furlpay.com/") && (
          <p className="mt-2 text-[13px]">
            <Link
              href={a.url.replace("https://furlpay.com", "")}
              className="text-neon transition-colors hover:text-white"
            >
              More about {a.name.split(" ")[0]} →
            </Link>
          </p>
        )}
        {a.sameAs.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-3 text-[12px]">
            {a.sameAs.map((href) => (
              <a
                key={href}
                href={href}
                rel="noopener noreferrer author"
                target="_blank"
                className="text-neon transition-colors hover:text-white"
              >
                {hostLabel(href)}
              </a>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function hostLabel(href: string): string {
  try {
    const h = new URL(href).hostname.replace(/^www\./, "");
    if (h.includes("github")) return "GitHub";
    if (h.includes("linkedin")) return "LinkedIn";
    if (h === "x.com" || h.includes("twitter")) return "X";
    return h;
  } catch {
    return href;
  }
}
