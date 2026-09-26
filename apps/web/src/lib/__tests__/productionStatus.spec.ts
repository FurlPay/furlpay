import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
  CAPABILITIES,
  STATUS_LABEL,
  capability,
  isLive,
  liveCapabilities,
} from "@/lib/productionStatus";

/*
 * These tests guard the two properties that made the Circle rejection
 * possible, and nothing else. They are not testing that the statuses are
 * CORRECT — no unit test can know whether a production credential exists — but
 * that a status cannot be vague, and that the copy on the site cannot claim
 * more than the registry does.
 */

describe("production status registry", () => {
  it("gives every capability a unique id", () => {
    const ids = CAPABILITIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("requires a stated gate for anything pending", () => {
    // "In development" with no gate is how a capability stays in development
    // for a year: nobody can tell what would move it. Naming the blocker makes
    // the entry falsifiable — when the credential lands, the gate reads false
    // and someone has to update it.
    for (const c of CAPABILITIES.filter((c) => c.status === "pending")) {
      expect(c.gate, `${c.id} is pending but names no gate`).toBeTruthy();
    }
  });

  it("requires evidence for every capability, live or not", () => {
    for (const c of CAPABILITIES) {
      expect(c.evidence.length, `${c.id} has no evidence`).toBeGreaterThan(20);
    }
  });

  it("does not mark money movement live while it is unconfigured in production", () => {
    // The specific claims Circle's reviewer could not exercise. If any of these
    // ever flips to live, it must be because the rail actually settles — and
    // this test is the place that forces someone to say so out loud.
    for (const id of [
      "x402-settlement",
      "mpp",
      "gasless",
      "agent-payments",
      "relayed-settlement",
      "trading",
      "tokenized-stocks",
      "banking",
      "cards",
      "mobile",
      "desktop",
    ]) {
      expect(isLive(id), `${id} must not be advertised as live`).toBe(false);
    }
  });

  it("keeps the genuinely live surface live", () => {
    for (const id of ["web", "passkeys", "developer-platform", "x402-challenge", "payment-apis"]) {
      expect(isLive(id), `${id} should be live`).toBe(true);
    }
  });

  it("throws on an unknown id rather than rendering an empty badge", () => {
    expect(() => capability("does-not-exist")).toThrow(/Unknown capability/);
  });

  it("exposes a label for every status", () => {
    for (const c of CAPABILITIES) {
      expect(STATUS_LABEL[c.status]).toBeTruthy();
    }
  });

  it("returns only live records from liveCapabilities()", () => {
    expect(liveCapabilities().every((c) => c.status === "live")).toBe(true);
  });
});

describe("claims linter", () => {
  it("finds no unqualified production claims in the public surface", () => {
    // Runs the real script so the test and the build gate cannot diverge.
    const script = join(process.cwd(), "scripts", "check-claims.mjs");
    const out = execFileSync(process.execPath, [script], { encoding: "utf8" });
    expect(out).toContain("no unqualified production claims");
  });
});
