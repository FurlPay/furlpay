// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { APP_TABS, navTabFor, SETTLEMENT_SECTIONS } from "@/lib/settlement/routes";

const nav = vi.hoisted(() => ({ path: "/settlement" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.path, useRouter: () => ({ push: () => undefined }) }));

import Header from "../Header";

afterEach(cleanup);

/** Every settlement screen and the tab it must highlight (null = none by design). */
const ROUTES: [string, string | null][] = [
  ["/settlement", "Overview"],
  ["/settlement/payments", "Payments"],
  ["/settlement/payments/transactions", "Payments"],
  ["/settlement/payments/invoices", "Payments"],
  ["/settlement/payouts", "Payouts"],
  ["/settlement/payouts/approvals", "Payouts"],
  ["/settlement/treasury", "Treasury"],
  ["/settlement/treasury/rules", "Treasury"],
  ["/settlement/virtual-accounts", "Treasury"],
  ["/settlement/compliance", "Compliance"],
  ["/settlement/reconcile", "Reconcile"],
  ["/settlement/reports", "Reconcile"],
  ["/settlement/developers", "Developers"],
  ["/ops/compliance/reviews", "Compliance"],
  ["/ops/compliance", "Compliance"],
  ["/ops/compliance/aml", "Compliance"],
  ["/settlement/settings", null],
  ["/settlement/onboarding/business", null],
];

describe("settlement header active tab", () => {
  it.each(ROUTES)("%s highlights %s", (path, tab) => {
    nav.path = path;
    render(<Header />);
    const current = screen.getByRole("navigation", { name: "Settlement" }).querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(tab ? 1 : 0);
    if (tab) expect(current[0].textContent).toBe(tab);
  });

  it("every URL section maps to a canonical tab label or deliberately to none", () => {
    const labels = new Set<string>(APP_TABS.map((t) => t.label));
    for (const s of SETTLEMENT_SECTIONS) {
      const t = navTabFor(`/settlement/${s}`);
      if (t !== null) expect(labels.has(t)).toBe(true);
    }
    expect(SETTLEMENT_SECTIONS.filter((s) => navTabFor(`/settlement/${s}`) === null)).toEqual(["settings"]);
  });

  it("normalises trailing slashes and query strings", () => {
    expect(navTabFor("/settlement/")).toBe("Overview");
    expect(navTabFor("/settlement/payouts?tab=x")).toBe("Payouts");
    expect(navTabFor("/settlementx")).toBeNull();
    expect(navTabFor(null)).toBeNull();
  });
});
