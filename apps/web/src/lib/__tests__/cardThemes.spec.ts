import { describe, it, expect } from "vitest";
import { CARD_THEMES, themeFor } from "@/lib/services/cardLifecycle";

// The three designs on /telegram are themes a customer can pick. The clients
// recognise them by this exact gradient (native-app/lib/cards/designs.ts,
// guardian CardDesign.kt, ios CardDesign.swift), because GET /api/cards sends a
// card's gradient and not its theme id. Changing a colour here without changing
// all three silently drops the artwork back to a plain two-colour card.
describe("card themes", () => {
  it("publishes the three FurlPay designs with the gradients the clients key on", () => {
    expect(themeFor("electric").gradient).toEqual(["#14197D", "#006BFF"]);
    expect(themeFor("world").gradient).toEqual(["#060B21", "#0B2A6B"]);
    expect(themeFor("pearl").gradient).toEqual(["#F1F0FF", "#C7A7F8"]);
  });

  it("offers them on the Standard plan", () => {
    for (const id of ["electric", "world", "pearl"]) expect(themeFor(id).premium).toBe(false);
  });

  it("keeps theme ids and gradients unique, so a gradient names one theme", () => {
    const ids = CARD_THEMES.map((t) => t.id);
    const gradients = CARD_THEMES.map((t) => t.gradient.join("|").toLowerCase());
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(gradients).size).toBe(gradients.length);
  });

  it("leaves the existing themes as they were", () => {
    expect(themeFor("midnight").gradient).toEqual(["#0B1220", "#1E293B"]);
  });
});
