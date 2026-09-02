import { describe, it, expect } from "vitest";
import { TERMS, TERM_CATEGORIES, getTerm, relatedTerms, termsInCategory } from "../glossary";
import { authorSlug, allAuthorNames, authorBySlug, getAuthor } from "@/lib/blog/authors";
import { POSTS } from "@/lib/blog/posts";

// ---------------------------------------------------------------------------
// The glossary and author pages are pure SEO surfaces, which is exactly why
// they need tests: nothing about them is visible in normal use, so a dangling
// link or a definition that has quietly grown into an essay produces no error
// anywhere — it just stops ranking, months later, for reasons nobody can
// reconstruct.
// ---------------------------------------------------------------------------

describe("glossary integrity", () => {
  it("has unique slugs", () => {
    const slugs = TERMS.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("has no dangling `see` references", () => {
    // relatedTerms() drops unknown slugs silently so a page never breaks. That
    // makes a typo invisible in the UI, so it has to fail here instead.
    const known = new Set(TERMS.map((t) => t.slug));
    const dangling: string[] = [];
    for (const t of TERMS) {
      for (const s of t.see ?? []) if (!known.has(s)) dangling.push(`${t.slug} -> ${s}`);
    }
    expect(dangling).toEqual([]);
  });

  it("never points a term at itself", () => {
    for (const t of TERMS) expect(t.see ?? []).not.toContain(t.slug);
  });

  it("uses only declared categories", () => {
    for (const t of TERMS) expect(TERM_CATEGORIES).toContain(t.category);
  });

  it("keeps every short definition in snippet range", () => {
    // Google lifts roughly 40-60 words for a featured snippet. Too short says
    // nothing; too long gets truncated mid-sentence, which reads as careless.
    for (const t of TERMS) {
      const words = t.short.trim().split(/\s+/).length;
      expect(words, `${t.slug} short definition is ${words} words`).toBeGreaterThanOrEqual(25);
      expect(words, `${t.slug} short definition is ${words} words`).toBeLessThanOrEqual(75);
    }
  });

  it("starts each definition with the thing being defined, not a preamble", () => {
    // "X is ..." wins snippets. "In the world of finance, X is ..." does not.
    for (const t of TERMS) {
      const first = t.short.split(/\s+/).slice(0, 4).join(" ").toLowerCase();
      expect(first, `${t.slug}: "${first}"`).not.toMatch(/^(in|when|as|for|the world|these days)\b/);
    }
  });

  it("has real body prose on every term", () => {
    for (const t of TERMS) {
      expect(t.body.length, t.slug).toBeGreaterThanOrEqual(2);
      for (const p of t.body) expect(p.trim().split(/\s+/).length).toBeGreaterThan(20);
    }
  });

  it("does not sell inside a definition", () => {
    // A glossary that pitches is not a glossary, and YMYL raters treat
    // promotional reference content as a quality signal in the wrong direction.
    const banned = /\bsign up\b|\bget started\b|\bbest[- ]in[- ]class\b|\bworld's first\b|\bunmatched\b/i;
    for (const t of TERMS) {
      const all = [t.short, ...t.body].join(" ");
      expect(banned.test(all), `${t.slug} contains promotional language`).toBe(false);
    }
  });

  it("resolves and filters correctly", () => {
    expect(getTerm("stablecoin")?.term).toBe("Stablecoin");
    expect(getTerm("no-such-term")).toBeUndefined();
    expect(relatedTerms(getTerm("x402")!).length).toBeGreaterThan(0);
    for (const c of TERM_CATEGORIES) {
      const inCat = termsInCategory(c);
      expect(inCat.every((t) => t.category === c)).toBe(true);
      // alphabetical, so the index reads as a reference rather than a dump
      expect(inCat.map((t) => t.term)).toEqual([...inCat.map((t) => t.term)].sort((a, b) => a.localeCompare(b)));
    }
  });
});

describe("author pages", () => {
  const BYLINES = POSTS.map((p) => p.author);

  it("gives every byline a resolvable page", () => {
    // generateStaticParams is built from this, so a byline that fails to round
    // trip is a 404 linked from every article it wrote.
    for (const b of BYLINES) {
      const slug = authorSlug(b);
      expect(slug, `empty slug for "${b}"`).not.toBe("");
      expect(authorBySlug(BYLINES, slug)).toBeTruthy();
    }
  });

  it("produces URL-safe slugs", () => {
    for (const { slug } of allAuthorNames(BYLINES)) {
      expect(slug).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    }
  });

  it("does not collapse two different authors into one page", () => {
    const names = allAuthorNames(BYLINES);
    expect(new Set(names.map((n) => n.slug)).size).toBe(names.length);
  });

  it("only claims a Person entity for a real person", () => {
    // Emitting schema.org/Person for a team byline is a false authorship
    // claim, which is precisely what a spam classifier looks for.
    for (const { name } of allAuthorNames(BYLINES)) {
      const a = getAuthor(name);
      if (!a.isPerson) expect(a.credentials).toBeUndefined();
      expect(a.sameAs.length, `${name} has no sameAs profiles`).toBeGreaterThan(0);
      for (const u of a.sameAs) expect(() => new URL(u)).not.toThrow();
    }
  });

  it("attributes every post to a byline that has a page", () => {
    const pages = new Set(allAuthorNames(BYLINES).map((n) => n.slug));
    for (const p of POSTS) expect(pages.has(authorSlug(p.author)), p.slug).toBe(true);
  });
});
