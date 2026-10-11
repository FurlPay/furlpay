import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OnboardingState } from "../onboarding";
const db = vi.hoisted(() => ({ row: undefined as { state: OnboardingState; updated_at: string; owner_id: string } | undefined }));
vi.mock("@/lib/supabase", () => ({
  supabaseBackend: "supabase",
  sbSelect: async () => db.row ? [structuredClone(db.row)] : [],
  sbInsertIgnoreDuplicates: async (_table: string, row: typeof db.row) => { if (!db.row) db.row = structuredClone(row); },
  sbUpdate: async (_table: string, query: string, patch: Partial<NonNullable<typeof db.row>>) => {
    const params = new URLSearchParams(query);
    const revision = params.get("state->>revision");
    if (!db.row || (revision === "is.null" ? !!db.row.state.revision : revision !== `eq.${db.row.state.revision}`)) return [];
    db.row = { ...db.row, ...structuredClone(patch) };
    return [structuredClone(db.row)];
  },
}));
import { emptyState } from "../onboarding";
import { loadState, updateState } from "../onboardingStore";

beforeEach(() => { db.row = undefined; });
describe("production optimistic concurrency", () => {
  it.each([false, true])("retains concurrent writes with a frozen clock (legacy row: %s)", async (existing) => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-10-08T12:00:00Z"));
      if (existing) db.row = { owner_id: "owner", state: emptyState(), updated_at: new Date().toISOString() };
      await Promise.all([
        updateState("owner", (s) => ({ ...s, completed: [...s.completed, "business"] })),
        updateState("owner", (s) => ({ ...s, completed: [...s.completed, "identity"] })),
      ]);
      expect((await loadState("owner")).completed.sort()).toEqual(["business", "identity"]);
      expect(db.row?.state.revision).toMatch(/^[\da-f-]{36}$/);
    } finally { vi.useRealTimers(); }
  });
});
