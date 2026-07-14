import { exclusive } from "../exclusive";

describe("exclusive (double-tap guard)", () => {
  it("a double-tap runs the action exactly once (BUG 4)", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const action = async () => {
      calls++;
      await gate;
      return "done";
    };

    // Two "taps" land synchronously, before any state re-render could disable
    // the button. Only the first may execute.
    const first = exclusive("challenge:c1", action);
    const second = exclusive("challenge:c1", action);
    release();

    expect(await first).toEqual({ ran: true, value: "done" });
    expect(await second).toEqual({ ran: false });
    expect(calls).toBe(1);
  });

  it("releases the key after completion so a retry works", async () => {
    let calls = 0;
    await exclusive("k", async () => {
      calls++;
    });
    await exclusive("k", async () => {
      calls++;
    });
    expect(calls).toBe(2);
  });

  it("releases the key after failure so a retry works (never wedges)", async () => {
    await expect(
      exclusive("f", async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");
    const retry = await exclusive("f", async () => "recovered");
    expect(retry).toEqual({ ran: true, value: "recovered" });
  });

  it("different keys do not block each other", async () => {
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const slow = exclusive("a", async () => {
      calls++;
      await gate;
    });
    const other = await exclusive("b", async () => {
      calls++;
    });
    release();
    await slow;
    expect(other.ran).toBe(true);
    expect(calls).toBe(2);
  });
});
