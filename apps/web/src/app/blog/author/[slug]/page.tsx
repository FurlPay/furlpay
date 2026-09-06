import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import JsonLd from "@/components/JsonLd";
import StoryCard from "@/components/blog/StoryCard";
import { POSTS, getSortedPosts } from "@/lib/blog/posts";
import { getAuthor, allAuthorNames, authorBySlug } from "@/lib/blog/authors";
import { breadcrumb, SITE, ORG_ID } from "@/lib/seo/schema";

// ---------------------------------------------------------------------------
// Author pages — the missing half of E-E-A-T.
//
// Every post already carries a credentialed byline and an AuthorBio block, but
// a byline that is only a string has no URL, so none of that credibility
// accumulates anywhere. Google's YMYL systems and the AI answer engines both
// resolve *entities*: a Person with a stable URL, a sameAs list pointing at
// profiles they can corroborate, and a body of work attached to it.
//
// This page is that URL. It is deliberately generated from the posts
// themselves rather than a hand-maintained list, so a byline can never point
// at a 404 and a new author needs no second edit to become linkable.
// ---------------------------------------------------------------------------

const BYLINES = POSTS.map((p) => p.author);

export function generateStaticParams() {
  return allAuthorNames(BYLINES).map(({ slug }) => ({ slug }));
}

export async function generateMetadata(props: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await props.params;
  const name = authorBySlug(BYLINES, slug);
  if (!name) return {};
  const a = getAuthor(name);
  const count = POSTS.filter((p) => p.author === name).length;
  const url = `${SITE}/blog/author/${slug}`;
  return {
    title: `${a.name} — Furlpay Blog`,
    // The description is the credential line, not the bio: it is what shows in
    // the SERP, and "who is this person" beats "what do they write about".
    description: `${a.role}${a.credentials ? ` · ${a.credentials}` : ""}. ${count} ${
      count === 1 ? "article" : "articles"
    } on Furlpay.`,
    alternates: { canonical: url },
    openGraph: { type: "profile", url, title: a.name, description: a.bio },
  };
}

export default async function AuthorPage(props: { params: Promise<{ slug: string }> }) {
  const { slug } = await props.params;
  const name = authorBySlug(BYLINES, slug);
  if (!name) notFound();

  const a = getAuthor(name);
  const posts = getSortedPosts().filter((p) => p.author === name);
  const url = `${SITE}/blog/author/${slug}`;

  // Person for a real human, Organization for a team byline. Emitting Person
  // for a group would be a false claim about authorship, and it is exactly the
  // kind of thing a spam classifier is built to notice.
  const entity = a.isPerson
    ? {
        "@context": "https://schema.org",
        "@type": "Person",
        "@id": `${url}#person`,
        name: a.name,
        url,
        jobTitle: a.role,
        description: a.bio,
        sameAs: a.sameAs,
        ...(a.url ? { mainEntityOfPage: a.url } : {}),
        worksFor: { "@id": ORG_ID },
        ...(a.credentials ? { knowsAbout: a.credentials } : {}),
      }
    : {
        "@context": "https://schema.org",
        "@type": "Organization",
        "@id": `${url}#org`,
        name: a.name,
        url,
        description: a.bio,
        sameAs: a.sameAs,
      };

  const monogram = a.name
    .split(" ")
    .map((w) => w[0])
    .slice(0, 2)
    .join("");

  return (
    <>
      <JsonLd
        data={[
          entity,
          breadcrumb([
            { name: "Blog", path: "/blog" },
            { name: a.name, path: `/blog/author/${slug}` },
          ]),
        ]}
      />

      <nav aria-label="Breadcrumb" className="text-[13px] text-textMuted">
        <Link href="/blog" className="transition-colors hover:text-white">
          Blog
        </Link>
        <span aria-hidden="true" className="px-2">
          /
        </span>
        <span className="text-textSecondary">{a.name}</span>
      </nav>

      <header className="mt-6 flex flex-col gap-5 sm:flex-row sm:items-start">
        {a.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={a.avatar}
            alt=""
            width={64}
            height={64}
            // h-18/w-18 are not in Tailwind's scale either (16, 20) and were
            // never generated, so this stretched the same way AuthorBio did.
            className="h-16 w-16 shrink-0 self-start rounded-full border border-white/10 object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border border-neon/30 bg-neon/10 text-xl font-bold text-neon"
          >
            {monogram}
          </div>
        )}
        <div className="min-w-0">
          <h1 className="text-3xl font-bold tracking-tight text-white">{a.name}</h1>
          <p className="mt-1 text-[13px] text-textMuted">
            {a.role}
            {a.credentials ? ` · ${a.credentials}` : ""}
          </p>
          <p className="mt-3 max-w-2xl text-[14px] leading-relaxed text-textSecondary">{a.bio}</p>
          {a.sameAs.length > 0 && (
            <ul className="mt-4 flex flex-wrap gap-3 text-[13px]">
              {a.sameAs.map((href) => (
                <li key={href}>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer me"
                    className="inline-flex min-h-[36px] items-center rounded-full border border-white/10 px-3 text-neon transition-colors hover:border-neon/40 hover:text-white"
                  >
                    {hostLabel(href)}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      </header>

      <section aria-labelledby="posts-heading" className="mt-12">
        <h2 id="posts-heading" className="text-lg font-bold text-white">
          {posts.length} {posts.length === 1 ? "article" : "articles"}
        </h2>
        {posts.length === 0 ? (
          <p className="mt-3 text-[14px] text-textSecondary">
            No articles under this byline yet.
          </p>
        ) : (
          <div className="mt-5 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {posts.map((p) => (
              <StoryCard key={p.slug} post={p} />
            ))}
          </div>
        )}
      </section>
    </>
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

