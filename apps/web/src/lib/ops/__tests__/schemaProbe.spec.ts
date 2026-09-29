import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// The schema probe.
//
// The property under test is narrow and is the whole reason the probe exists:
//
//   a check that could not RUN must never report as a check that PASSED.
//
// Dividend settlement is safe under concurrency because of a UNIQUE constraint
// in the database, not because of anything in TypeScript. If that constraint is
// absent the code still runs and every other test still passes — the symptom is
// a double credit under concurrency, found during reconciliation if at all.
//
// So the dangerous bug in a probe like this is optimism: swallowing a missing
// RPC, a permission error or a timeout and returning "operational". Most of the
// cases below are therefore about FAILURE paths, and each asserts the status is
// not "operational" rather than merely asserting it is truthy.
// ---------------------------------------------------------------------------

const { sbRpc, backend } = vi.hoisted(() => ({
  sbRpc: vi.fn(),
  backend: { value: "supabase" as "supabase" | "none" },
}));

class FakeFunctionMissing extends Error {}

vi.mock("@/lib/supabase", () => ({
  sbRpc,
  SupabaseFunctionMissing: FakeFunctionMissing,
  get supabaseBackend() {
    return backend.value;
  },
}));

const { probeRequiredConstraints, SCHEMA_ASSERTION_FN } = await import("../schemaProbe");

beforeEach(() => {
  sbRpc.mockReset();
  backend.value = "supabase";
});

describe("when the constraints are present", () => {
  it("reports operational on an empty missing-list", async () => {
    sbRpc.mockResolvedValue([]);
    expect(await probeRequiredConstraints()).toEqual({ status: "operational" });
  });

  it("asks the database, rather than assuming", async () => {
    sbRpc.mockResolvedValue([]);
    await probeRequiredConstraints();
    expect(sbRpc).toHaveBeenCalledWith(SCHEMA_ASSERTION_FN, {});
  });

  it("treats a null result as empty rather than crashing", async () => {
    sbRpc.mockResolvedValue(null);
    expect((await probeRequiredConstraints()).status).toBe("operational");
  });
});

describe("when a required constraint is absent", () => {
  const row = {
    constraint_name: "dividend_once_per_user",
    table_name: "dividend_events",
    purpose: "Stops a dividend being credited twice under concurrent settlement",
  };

  it("reports down, not degraded", async () => {
    // A missing constraint will not recover on its own the way a slow RPC
    // will. It is absent until someone applies a migration.
    sbRpc.mockResolvedValue([row]);
    expect((await probeRequiredConstraints()).status).toBe("down");
  });

  it("names the constraint and the table so the fix is obvious", async () => {
    sbRpc.mockResolvedValue([row]);
    const res = await probeRequiredConstraints();
    expect(res.missing).toEqual([
      {
        constraint: "dividend_once_per_user",
        table: "dividend_events",
        purpose: row.purpose,
      },
    ]);
    expect(res.detail).toContain("dividend_events.dividend_once_per_user");
  });

  it("says plainly that idempotency is not enforced", async () => {
    sbRpc.mockResolvedValue([row]);
    const res = await probeRequiredConstraints();
    expect(res.detail).toMatch(/NOT enforced by the database/);
  });

  it("reports every missing constraint, not just the first", async () => {
    sbRpc.mockResolvedValue([
      row,
      { constraint_name: "reorg_once_per_user", table_name: "reorg_events", purpose: "x" },
    ]);
    const res = await probeRequiredConstraints();
    expect(res.missing).toHaveLength(2);
    expect(res.detail).toContain("reorg_events.reorg_once_per_user");
  });
});

describe("when the check cannot run", () => {
  it("reports unverified — NOT operational — when the RPC is missing", async () => {
    // Migration 0017 not applied. The single most important case here: this is
    // the state every environment is in before the migration ships, and
    // reporting it as healthy would be a false assurance on the exact question
    // the probe was built to answer.
    sbRpc.mockRejectedValue(new FakeFunctionMissing(SCHEMA_ASSERTION_FN));
    const res = await probeRequiredConstraints();
    expect(res.status).toBe("unverified");
    expect(res.status).not.toBe("operational");
  });

  it("points at the migration that makes the check possible", async () => {
    sbRpc.mockRejectedValue(new FakeFunctionMissing(SCHEMA_ASSERTION_FN));
    const res = await probeRequiredConstraints();
    expect(res.detail).toContain("0017_schema_assertions.sql");
    expect(res.detail).toMatch(/UNVERIFIED/);
  });

  it("reports unverified on any other error, and never operational", async () => {
    for (const err of [
      new Error("permission denied for table pg_constraint"),
      new Error("fetch failed"),
      new Error("timeout"),
    ]) {
      sbRpc.mockRejectedValueOnce(err);
      const res = await probeRequiredConstraints();
      expect(res.status, err.message).toBe("unverified");
    }
  });

  it("does not leak a long provider error into the detail", async () => {
    sbRpc.mockRejectedValue(new Error("x".repeat(500)));
    const res = await probeRequiredConstraints();
    expect(res.detail!.length).toBeLessThan(220);
  });
});

describe("when there is no Postgres at all", () => {
  it("reports not_configured rather than claiming the constraint exists", async () => {
    // The in-memory demo store. There is no constraint to assert, and saying
    // "operational" would be a lie in the other direction.
    backend.value = "none";
    const res = await probeRequiredConstraints();
    expect(res.status).toBe("not_configured");
    expect(sbRpc).not.toHaveBeenCalled();
  });
});
