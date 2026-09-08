import { __pooledForTest as pooled } from "../discovery";

// ---------------------------------------------------------------------------
// The concurrency pool.
//
// Small, and worth testing on its own, because it is the thing standing between
// a portfolio refresh and a 429 from the RPC proxy (120 req/min per user). The
// interesting properties are that it NEVER exceeds the limit, that one
// rejection does not stop the others, and that results come back in INPUT
// order — the caller pairs `results[i]` with `tasks[i]` to know which chain
// failed, so a reordering would attribute a failure to the wrong network.
// ---------------------------------------------------------------------------

describe("pooled", () => {
  it("returns results in input order regardless of completion order", async () => {
    const delays = [30, 5, 20, 1];
    const tasks = delays.map((ms, i) => async () => {
      await new Promise((r) => setTimeout(r, ms));
      return i;
    });

    const results = await pooled(tasks, 4);
    expect(results.map((r) => (r.status === "fulfilled" ? r.value : null))).toEqual([0, 1, 2, 3]);
  });

  it("never runs more than `limit` tasks at once", async () => {
    let active = 0;
    let peak = 0;
    const tasks = Array.from({ length: 20 }, () => async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, 2));
      active--;
      return 1;
    });

    await pooled(tasks, 3);
    expect(peak).toBeLessThanOrEqual(3);
    expect(peak).toBeGreaterThan(1);
  });

  // One chain being down must not blank the portfolio for the ones that
  // answered.
  it("isolates a rejection", async () => {
    const tasks = [
      async () => "a",
      async () => {
        throw new Error("chain down");
      },
      async () => "c",
    ];

    const results = await pooled(tasks, 2);
    expect(results[0]).toEqual({ status: "fulfilled", value: "a" });
    expect(results[1].status).toBe("rejected");
    expect(results[2]).toEqual({ status: "fulfilled", value: "c" });
  });

  it("handles an empty task list", async () => {
    expect(await pooled([], 4)).toEqual([]);
  });

  it("handles a limit larger than the task count", async () => {
    const results = await pooled([async () => 1], 10);
    expect(results).toEqual([{ status: "fulfilled", value: 1 }]);
  });
});
