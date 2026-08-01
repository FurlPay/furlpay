import {
  BaseDeviceConnection,
  ConnectionError,
  describeBlocker,
  describeFailure,
  isReady,
  nextAction,
  type ConnectionFailure,
  type ConnectionState,
  type ReadinessBlocker,
} from "../signing/connection";

// ---------------------------------------------------------------------------
// The connection layer, which is where hardware wallet failures actually live.
//
// No hardware is needed to test any of this, because the vendor-specific part
// is exactly two methods (`establish` / `teardown`) and everything else — the
// state machine, listener fan-out, coalescing, and the copy a user reads — is
// shared. A fake transport exercises all of it.
//
// The case worth reading twice is "connected but locked". A single status enum
// cannot express it, and it is the most common state a user is really in.
// ---------------------------------------------------------------------------

class FakeConnection extends BaseDeviceConnection {
  establishCalls = 0;
  teardownCalls = 0;
  /** Resolves `establish` manually, so a test can observe mid-connect state. */
  private release?: () => void;
  private reject?: (e: unknown) => void;

  constructor(private readonly behaviour: "resolve" | "reject" | "manual" = "resolve") {
    super();
  }

  protected async establish(): Promise<void> {
    this.establishCalls++;
    if (this.behaviour === "reject") {
      throw new ConnectionError("bluetooth-off", describeFailure("bluetooth-off"));
    }
    if (this.behaviour === "manual") {
      return new Promise<void>((resolve, reject) => {
        this.release = resolve;
        this.reject = reject;
      });
    }
  }

  protected async teardown(): Promise<void> {
    this.teardownCalls++;
  }

  finish(): void {
    this.release?.();
  }
  fail(e: unknown): void {
    this.reject?.(e);
  }
  /** Exposes the protected hooks for the tests below. */
  setBlockers(blockers: ReadinessBlocker[]): void {
    this.update({ blockers });
  }
  dropLink(): void {
    this.onLinkLost();
  }
}

describe("phase and readiness are independent axes", () => {
  it("expresses 'connected but locked' — the state a single enum cannot hold", async () => {
    const conn = new FakeConnection();
    await conn.connect();
    conn.setBlockers(["locked"]);

    const state = conn.state();
    // Transport is genuinely up. The device genuinely cannot sign. Both true.
    expect(state.phase).toBe("connected");
    expect(state.blockers).toEqual(["locked"]);
    expect(isReady(state)).toBe(false);
  });

  it("is ready only when connected AND unblocked", async () => {
    const conn = new FakeConnection();
    expect(isReady(conn.state())).toBe(false); // disconnected

    await conn.connect();
    expect(isReady(conn.state())).toBe(true);

    conn.setBlockers(["wrong-app"]);
    expect(isReady(conn.state())).toBe(false);
  });
});

describe("connect", () => {
  it("is idempotent — a screen may call it defensively on every mount", async () => {
    const conn = new FakeConnection();
    await conn.connect();
    await conn.connect();
    // Reconnecting an already-connected device would tear down a working link.
    expect(conn.establishCalls).toBe(1);
  });

  it("coalesces concurrent attempts onto one radio operation", async () => {
    const conn = new FakeConnection("manual");
    const a = conn.connect();
    const b = conn.connect();
    expect(conn.state().phase).toBe("connecting");

    conn.finish();
    await Promise.all([a, b]);

    // Two screens must not start two competing scans.
    expect(conn.establishCalls).toBe(1);
    expect(conn.state().phase).toBe("connected");
  });

  it("records why it failed and returns to disconnected", async () => {
    const conn = new FakeConnection("reject");
    await expect(conn.connect()).rejects.toBeInstanceOf(ConnectionError);

    const state = conn.state();
    expect(state.phase).toBe("disconnected");
    expect(state.lastError?.reason).toBe("bluetooth-off");
  });

  it("wraps an unexpected throw rather than leaking it as 'connecting'", async () => {
    const conn = new FakeConnection("manual");
    const attempt = conn.connect();
    conn.fail(new TypeError("undefined is not an object"));

    await expect(attempt).rejects.toBeInstanceOf(ConnectionError);
    // A stuck "connecting" phase is a spinner that never stops.
    expect(conn.state().phase).toBe("disconnected");
    expect(conn.state().lastError?.reason).toBe("unknown");
  });

  it("clears a stale error when a new attempt starts", async () => {
    const conn = new FakeConnection("reject");
    await expect(conn.connect()).rejects.toThrow();
    expect(conn.state().lastError).toBeDefined();

    const ok = new FakeConnection("manual");
    const attempt = ok.connect();
    expect(ok.state().lastError).toBeUndefined();
    ok.finish();
    await attempt;
  });
});

describe("disconnect", () => {
  it("reports disconnected even when teardown throws", async () => {
    class Broken extends FakeConnection {
      protected async teardown(): Promise<void> {
        throw new Error("BLE stack wedged");
      }
    }
    const conn = new Broken();
    await conn.connect();
    await expect(conn.disconnect()).rejects.toThrow();

    // A failed teardown still leaves us without a usable link. Reporting
    // "connected" would strand the UI on a device it cannot reach.
    expect(conn.state().phase).toBe("disconnected");
  });

  it("clears blockers, which belonged to the old session", async () => {
    const conn = new FakeConnection();
    await conn.connect();
    conn.setBlockers(["locked"]);
    await conn.disconnect();
    expect(conn.state().blockers).toEqual([]);
  });
});

describe("subscribers", () => {
  it("fires immediately so a mid-connection mount is never blank", async () => {
    const conn = new FakeConnection("manual");
    void conn.connect();

    const seen: ConnectionState[] = [];
    conn.subscribe((s) => seen.push(s));

    // A screen mounting during a scan must render "connecting", not nothing.
    expect(seen).toHaveLength(1);
    expect(seen[0].phase).toBe("connecting");
    conn.finish();
  });

  it("stops delivering after unsubscribe", async () => {
    const conn = new FakeConnection();
    const seen: ConnectionState[] = [];
    const stop = conn.subscribe((s) => seen.push(s));
    const initial = seen.length;

    stop();
    await conn.connect();
    // A leaked subscriber keeps a dead screen updating.
    expect(seen).toHaveLength(initial);
  });

  it("survives a throwing listener", async () => {
    const conn = new FakeConnection();
    conn.subscribe(() => {
      throw new Error("render crashed");
    });
    const seen: ConnectionState[] = [];
    conn.subscribe((s) => seen.push(s));

    await expect(conn.connect()).resolves.toBeUndefined();
    // A broken screen is not a broken radio.
    expect(seen.some((s) => s.phase === "connected")).toBe(true);
  });

  it("reports a link that drops on its own", async () => {
    const conn = new FakeConnection();
    await conn.connect();
    conn.dropLink();

    expect(conn.state().phase).toBe("disconnected");
    expect(conn.state().lastError?.reason).toBe("link-lost");
  });
});

describe("what the user is told", () => {
  it("names a remedy for every failure, not just the problem", () => {
    const reasons: ConnectionFailure[] = [
      "bluetooth-off",
      "bluetooth-unauthorized",
      "bluetooth-unsupported",
      "nfc-off",
      "nfc-unsupported",
      "no-device-found",
      "pairing-rejected",
      "link-lost",
      "timeout",
      "cancelled",
      "unknown",
    ];
    for (const reason of reasons) {
      const copy = describeFailure(reason);
      expect(copy.length).toBeGreaterThan(0);
      // No internal vocabulary on a screen.
      expect(copy).not.toMatch(/bluetooth-|nfc-|[A-Z]{2,}_/);
    }
  });

  it("distinguishes 'Bluetooth is off' from 'we lack permission'", () => {
    // These send the user to two different places and only one is a Settings
    // deep link. Collapsing them into "connection failed" strands them.
    expect(describeFailure("bluetooth-off")).not.toBe(describeFailure("bluetooth-unauthorized"));
    expect(describeFailure("bluetooth-unauthorized")).toMatch(/permission/i);
  });

  it("names the device in a blocker so the instruction is concrete", () => {
    expect(describeBlocker("locked", "your Ledger")).toMatch(/Unlock your Ledger/);
    expect(describeBlocker("wrong-app", "your Ledger")).toMatch(/Ethereum app/);
  });
});

describe("nextAction", () => {
  it("asks about transport before readiness", async () => {
    // "Unlock your Ledger" is nonsense advice when the app cannot see it.
    const conn = new FakeConnection("reject");
    await expect(conn.connect()).rejects.toThrow();
    expect(nextAction(conn.state())).toMatch(/Bluetooth is off/);
  });

  it("surfaces the first blocker once connected", async () => {
    const conn = new FakeConnection();
    await conn.connect();
    conn.setBlockers(["locked", "wrong-app"]);
    expect(nextAction(conn.state())).toMatch(/Unlock/);
  });

  it("says nothing when the device is ready", async () => {
    const conn = new FakeConnection();
    await conn.connect();
    // Null, not "Ready" — a prompt with nothing to do is noise.
    expect(nextAction(conn.state())).toBeNull();
  });

  it("prefers a real error over a generic prompt when disconnected", () => {
    const withError: ConnectionState = {
      phase: "disconnected",
      blockers: [],
      lastError: new ConnectionError("no-device-found", describeFailure("no-device-found")),
    };
    expect(nextAction(withError)).toMatch(/No wallet found/);

    const fresh: ConnectionState = { phase: "disconnected", blockers: [] };
    expect(nextAction(fresh)).toMatch(/Connect/);
  });
});
