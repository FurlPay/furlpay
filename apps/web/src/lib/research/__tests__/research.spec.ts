import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In-memory KV with TTL-free semantics; enough for single-use and replay.
const store = new Map<string, unknown>();
vi.mock("@/lib/kv", () => ({
  kvBackend: "redis",
  kvGet: async (k: string) => (store.has(k) ? store.get(k) : null),
  kvSet: async (k: string, v: unknown) => void store.set(k, v),
  kvSetNx: async (k: string, v: unknown) => (store.has(k) ? false : (store.set(k, v), true)),
  kvDel: async (k: string) => void store.delete(k),
  kvIncr: async (k: string) => {
    const n = ((store.get(k) as number) ?? 0) + 1;
    store.set(k, n);
    return n;
  },
}));

const { issueVerificationToken, consumeVerificationToken, readGrant, redeemGrantUse, GRANT_MAX_USES, sha256 } = await import("../access");
const { isDisposableEmail } = await import("../disposable");
const { signedPdfUrl, storageConfigured } = await import("../storage");
const { isPubliclyVisible, REPORTS, filterResearch, publishedReports } = await import("@/lib/content");
const { sanitizeFilters } = await import("@/components/content/ResearchLibrary");

beforeEach(() => store.clear());
afterEach(() => vi.restoreAllMocks());

describe("editorial visibility", () => {
  const at = (status: string, publishedAt = "2026-01-01") => ({ status, publishedAt }) as never;
  it("only published, or scheduled whose date has passed, is public", () => {
    for (const s of ["draft", "review", "approved", "archived"]) expect(isPubliclyVisible(at(s)), s).toBe(false);
    expect(isPubliclyVisible(at("published"))).toBe(true);
    expect(isPubliclyVisible(at("scheduled", "2026-01-01"), Date.parse("2026-02-01"))).toBe(true);
    expect(isPubliclyVisible(at("scheduled", "2026-03-01"), Date.parse("2026-02-01"))).toBe(false);
    expect(isPubliclyVisible(at("scheduled", "not-a-date"))).toBe(false);
  });

  it("the 2026 report is in review and therefore NOT on the public site", () => {
    const r = REPORTS.find((x) => x.slug === "global-stablecoin-report-2026");
    expect(r?.status).toBe("review");
    expect(publishedReports().some((x) => x.slug === "global-stablecoin-report-2026")).toBe(false);
  });
});

describe("the 2026 report record — provenance integrity", () => {
  const r = REPORTS.find((x) => x.slug === "global-stablecoin-report-2026")!;
  const refs = new Set(r.sources!.map((s) => s.ref));

  it("every reference cited by a figure or finding resolves to a listed source", () => {
    const cited = [...(r.metrics ?? []).flatMap((m) => m.refs ?? []), ...(r.keyFindings ?? []).flatMap((f) => f.refs ?? [])];
    expect(cited.length).toBeGreaterThan(0);
    for (const n of cited) expect(refs.has(n), `ref [${n}]`).toBe(true);
  });

  it("every headline figure carries context and an evidence label", () => {
    for (const m of r.metrics!) {
      expect(m.context.length, m.label).toBeGreaterThan(10);
      expect(m.evidence, m.label).toBeTruthy();
    }
  });

  it("no source URL is invented (the PDF lists none)", () => {
    expect(r.sources!.every((s) => s.url === undefined)).toBe(true);
  });

  it("the PDF is private, versioned and checksummed — never a public path", () => {
    expect(r.pdfPath).toBeUndefined();
    expect(r.privatePdf).toMatchObject({ objectKey: "global-stablecoin-report-2026/v1.0.pdf", version: "1.0" });
    expect(r.privatePdf!.sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it("keeps all 16 findings", () => expect(r.keyFindings).toHaveLength(16));
});

describe("library filters", () => {
  const fixture = [
    { slug: "a", status: "published", title: "USDC supply", description: "", category: "Stablecoins", publishedAt: "2026-10-01", desk: "stablecoin-markets", cadence: "monthly" },
    { slug: "b", status: "published", title: "Bridge exploit", description: "", category: "Security", publishedAt: "2025-05-01", desk: "security", cadence: "weekly" },
  ] as never[];

  it("filters by desk, cadence, year and text", () => {
    expect(filterResearch({ desk: "security" }, fixture).map((r) => r.slug)).toEqual(["b"]);
    expect(filterResearch({ cadence: "monthly" }, fixture).map((r) => r.slug)).toEqual(["a"]);
    expect(filterResearch({ year: "2025" }, fixture).map((r) => r.slug)).toEqual(["b"]);
    expect(filterResearch({ q: "usdc" }, fixture).map((r) => r.slug)).toEqual(["a"]);
  });

  it("drops filter values it does not recognise instead of trusting them", () => {
    expect(sanitizeFilters({ desk: "nope", cadence: "hourly", year: "19999", q: "x".repeat(200) })).toEqual({
      desk: undefined, cadence: undefined, year: undefined, q: "x".repeat(80),
    });
    expect(sanitizeFilters({ desk: "regulation", cadence: "annual", year: "2026" })).toMatchObject({ desk: "regulation", cadence: "annual", year: "2026" });
  });
});

describe("disposable mailboxes", () => {
  it("refuses throwaway services, including their subdomains", () => {
    expect(isDisposableEmail("a@mailinator.com")).toBe(true);
    expect(isDisposableEmail("a@x.mailinator.com")).toBe(true);
    expect(isDisposableEmail("A@YOPMAIL.COM")).toBe(true);
  });
  it("accepts consumer providers, small businesses and look-alike domains", () => {
    for (const e of ["a@gmail.com", "a@outlook.com", "founder@tinyco.sg", "a@notmailinator.com", "x@proton.me"]) {
      expect(isDisposableEmail(e), e).toBe(false);
    }
  });
});

describe("verification tokens and grants", () => {
  const input = { slug: "global-stablecoin-report-2026", objectKey: "global-stablecoin-report-2026/v1.0.pdf", email: "Reader@Example.com" };

  it("stores only a HASH of the token and of the email", async () => {
    const token = await issueVerificationToken(input);
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const dump = JSON.stringify([...store]);
    expect(dump).not.toContain(token);
    expect(dump.toLowerCase()).not.toContain("reader@example.com");
    expect(dump).toContain(sha256(token));
  });

  it("consumes a token exactly once; a replay is refused", async () => {
    const token = await issueVerificationToken(input);
    const first = await consumeVerificationToken(token);
    expect(first.ok).toBe(true);
    expect(await consumeVerificationToken(token)).toEqual({ ok: false, reason: "used" });
  });

  it("concurrent redemption of one token mints exactly one grant", async () => {
    const token = await issueVerificationToken(input);
    const results = await Promise.all([consumeVerificationToken(token), consumeVerificationToken(token), consumeVerificationToken(token)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("treats malformed, unknown and guessed tokens identically", async () => {
    for (const t of ["", "short", "../../etc/passwd", "A".repeat(43), 42 as never]) {
      expect(await consumeVerificationToken(t)).toEqual({ ok: false, reason: "invalid" });
    }
  });

  it("a grant names exactly one object and expires", async () => {
    const token = await issueVerificationToken(input);
    const r = await consumeVerificationToken(token);
    if (!r.ok) throw new Error("expected ok");
    expect(await readGrant(r.grantId)).toMatchObject({ slug: input.slug, objectKey: input.objectKey });
    store.set(`research:grant:${r.grantId}`, { ...r.grant, expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect(await readGrant(r.grantId)).toBeNull();
    expect(await readGrant("not-a-grant")).toBeNull();
  });

  it("a grant redeems at most GRANT_MAX_USES times, even concurrently", async () => {
    const id = "G".repeat(43);
    const results = await Promise.all(Array.from({ length: 10 }, () => redeemGrantUse(id)));
    expect(results.filter(Boolean)).toHaveLength(GRANT_MAX_USES);
  });
});

describe("private storage", () => {
  const env = { SUPABASE_URL: "https://proj.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "service-key", RESEARCH_PDF_BUCKET: "research-private" } as NodeJS.ProcessEnv;

  it("reports not_configured instead of falling back to anything public", async () => {
    expect(storageConfigured({} as NodeJS.ProcessEnv)).toBe(false);
    expect(await signedPdfUrl("a/v1.pdf", {} as NodeJS.ProcessEnv)).toEqual({ ok: false, reason: "not_configured" });
  });

  it("refuses unsafe object keys without calling storage", async () => {
    const f = vi.spyOn(globalThis, "fetch");
    for (const k of ["../secret.pdf", "/abs.pdf", "a/b.txt", "a/../../b.pdf"]) {
      expect((await signedPdfUrl(k, env)).ok).toBe(false);
    }
    expect(f).not.toHaveBeenCalled();
  });

  it("asks for a 60-second signature and returns the absolute signed URL", async () => {
    const f = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ signedURL: "/object/sign/research-private/a/v1.pdf?token=abc" }), { status: 200 }),
    );
    const r = await signedPdfUrl("a/v1.pdf", env);
    expect(r).toEqual({ ok: true, url: "https://proj.supabase.co/storage/v1/object/sign/research-private/a/v1.pdf?token=abc" });
    const [url, init] = f.mock.calls[0];
    expect(String(url)).toBe("https://proj.supabase.co/storage/v1/object/sign/research-private/a/v1.pdf");
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ expiresIn: 60 });
  });

  it("maps a storage error to unavailable", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 400 }));
    expect(await signedPdfUrl("a/v1.pdf", env)).toEqual({ ok: false, reason: "unavailable" });
  });
});
