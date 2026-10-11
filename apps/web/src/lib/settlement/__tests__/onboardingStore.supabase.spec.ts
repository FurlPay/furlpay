import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Supabase path of the onboarding store against an in-memory PostgREST
// double that evaluates the store's real filter strings, so the
// compare-and-swap predicate is what decides whether a write lands.
const db = vi.hoisted(() => {
  process.env.SUPABASE_URL = "https://sb.test";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  return { rows: new Map<string, { owner_id: string; state: Record<string, unknown>; updated_at: string }>(), writes: 0 };
});

function matches(row: { owner_id: string; state: Record<string, unknown> }, query: string) {
  return query
    .split("&")
    .filter((c) => !c.startsWith("limit="))
    .every((c) => {
      const [key, cond] = [c.slice(0, c.indexOf("=")), c.slice(c.indexOf("=") + 1)];
      const actual = key === "owner_id" ? row.owner_id : key.startsWith("state->>") ? row.state[key.slice(8)] : undefined;
      if (cond === "is.null") return actual === undefined || actual === null;
      if (cond.startsWith("eq.")) return actual === decodeURIComponent(cond.slice(3));
      throw new Error(`unsupported filter ${c}`);
    });
}

vi.mock("@/lib/supabase", () => ({
  supabaseBackend: "supabase",
  sbSelect: async (_t: string, q: string) => [...db.rows.values()].filter((r) => matches(r, q)).map((r) => structuredClone(r)),
  sbInsertIgnoreDuplicates: async (_t: string, row: { owner_id: string; state: Record<string, unknown>; updated_at: string }) => {
    if (!db.rows.has(row.owner_id)) db.rows.set(row.owner_id, structuredClone(row));
  },
  sbUpdate: async (_t: string, q: string, patch: { state: Record<string, unknown>; updated_at: string }) => {
    const hit = [...db.rows.values()].filter((r) => matches(r, q));
    for (const r of hit) Object.assign(r, structuredClone(patch));
    db.writes += hit.length;
    return hit;
  },
}));

import { emptyState, type DocumentRecord } from "../onboarding";
import { OnboardingUnavailable, readDocument, updateState } from "../onboardingStore";

const doc = (kind: DocumentRecord["kind"], size = 4): DocumentRecord => ({ id: crypto.randomUUID(), kind, name: kind, size, contentType: "application/pdf", uploadedAt: "", review: "received" });

/** Two writers that both read before either writes — the race that loses an update. */
async function racingUploads(userId: string) {
  let entered = 0;
  let open!: () => void;
  const barrier = new Promise<void>((r) => (open = r));
  const writer = (kind: DocumentRecord["kind"]) =>
    updateState(userId, async (s) => {
      if (++entered === 2) open();
      await barrier;
      s.documents.push(doc(kind));
      return s;
    });
  await Promise.all([writer("incorporation"), writer("articles")]);
  return db.rows.get(userId)!.state as { documents: DocumentRecord[]; revision?: string };
}

beforeEach(() => {
  db.rows.clear();
  db.writes = 0;
  // Freeze the clock: both writers stamp the identical updatedAt.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-08T12:00:00.000Z"));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("onboarding store on Supabase", () => {
  it("does not lose an update when two writes land in the same millisecond", async () => {
    const t = new Date().toISOString();
    db.rows.set("u1", { owner_id: "u1", state: { ...emptyState(), revision: "r0", updatedAt: t }, updated_at: t });
    const state = await racingUploads("u1");
    expect(state.documents.map((d) => d.kind).sort()).toEqual(["articles", "incorporation"]);
    expect(state.revision).not.toBe("r0");
  });

  it("upgrades a legacy row (no revision) without letting a second writer overwrite the upgrade", async () => {
    const t = new Date().toISOString();
    db.rows.set("u2", { owner_id: "u2", state: { ...emptyState(), updatedAt: t }, updated_at: t });
    const state = await racingUploads("u2");
    expect(state.documents.map((d) => d.kind).sort()).toEqual(["articles", "incorporation"]);
    expect(typeof state.revision).toBe("string");
  });

  it("two first writes race to create the row and neither is lost", async () => {
    const state = await racingUploads("u3");
    expect(state.documents.map((d) => d.kind).sort()).toEqual(["articles", "incorporation"]);
  });

  it("gives up with OnboardingUnavailable rather than overwrite under constant contention", async () => {
    const t = new Date().toISOString();
    db.rows.set("u4", { owner_id: "u4", state: { ...emptyState(), revision: "r0", updatedAt: t }, updated_at: t });
    let n = 0;
    await expect(
      updateState("u4", (s) => {
        // Another writer changes the row between every read and write.
        db.rows.get("u4")!.state.revision = `other-${n++}`;
        return s;
      })
    ).rejects.toBeInstanceOf(OnboardingUnavailable);
    expect(db.writes).toBe(0);
  });
});

describe("reading a stored document", () => {
  it("proxies the bytes and refuses a stored object whose size does not match its record", async () => {
    const bytes = new TextEncoder().encode("%PDF");
    vi.stubGlobal("fetch", vi.fn(async () => new Response(bytes, { status: 200 })));
    expect((await readDocument("u1", doc("incorporation", 4))).bytes).toEqual(bytes);
    await expect(readDocument("u1", doc("incorporation", 5))).rejects.toBeInstanceOf(OnboardingUnavailable);
    const [url, init] = (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/storage/v1/object/authenticated/kyb-documents/");
    expect(init.method ?? "GET").toBe("GET");
  });

  it("a storage error is unavailable, never a redirect to a reusable URL", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 404 })));
    await expect(readDocument("u1", doc("incorporation"))).rejects.toBeInstanceOf(OnboardingUnavailable);
  });
});
