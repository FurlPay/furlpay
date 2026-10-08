import { afterEach, describe, expect, it } from "vitest";
import { loadState, Refusal, resetDevelopmentStore, updateState } from "../onboardingStore";

// supabaseBackend is "none" under test, and NODE_ENV is "test" → the development store.
afterEach(() => resetDevelopmentStore());

describe("onboarding store", () => {
  it("serialises concurrent updates so none is lost", async () => {
    const kinds = ["incorporation", "articles", "address", "id_front"] as const;
    await Promise.all(
      kinds.map((kind, i) =>
        updateState("u1", async (s) => {
          await new Promise((r) => setTimeout(r, 5 * (4 - i)));
          s.documents.push({ id: `00000000-0000-4000-8000-00000000000${i}`, kind, name: kind, size: 1, contentType: "application/pdf", uploadedAt: "", review: "received" });
          return s;
        })
      )
    );
    expect((await loadState("u1")).documents.map((d) => d.kind).sort()).toEqual([...kinds].sort());
  });

  it("a refusal writes nothing", async () => {
    await updateState("u2", (s) => ({ ...s, completed: ["business"] }));
    await expect(
      updateState("u2", (s) => {
        s.completed.push("identity");
        throw new Refusal("no", 409);
      })
    ).rejects.toBeInstanceOf(Refusal);
    expect((await loadState("u2")).completed).toEqual(["business"]);
  });

  it("keeps each user's state separate", async () => {
    await updateState("a", (s) => ({ ...s, completed: ["business"] }));
    expect((await loadState("b")).completed).toEqual([]);
  });
});
