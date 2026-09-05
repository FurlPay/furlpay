import {
  IllegalTransitionError,
  TX_STATES,
  canTransition,
  canUserCancel,
  canUserRetry,
  isPending,
  isSettled,
  isTerminalState,
  parseTxState,
  requiresIdempotentRetry,
  statusMessageKey,
  toMoneyStatus,
  transition,
  type TxState,
} from "../transactionState";

describe("the money invariant: a client-side send is not a success", () => {
  it("has NO path from CREATED straight to COMPLETED", () => {
    expect(canTransition("CREATED", "COMPLETED")).toBe(false);
  });

  it("has NO path from SUBMITTED straight to COMPLETED", () => {
    // This is the whole point of the file. If this ever becomes legal, the UI
    // can show a green tick because a fetch resolved.
    expect(canTransition("SUBMITTED", "COMPLETED")).toBe(false);
  });

  it("reaches COMPLETED only via PROCESSING, which only the server sets", () => {
    const reachers = TX_STATES.filter((s) => canTransition(s, "COMPLETED"));
    expect(reachers).toEqual(["PROCESSING"]);
  });
});

describe("transitions", () => {
  it("allows the happy path", () => {
    let s: TxState = "CREATED";
    s = transition(s, "SUBMITTED");
    s = transition(s, "PROCESSING");
    s = transition(s, "COMPLETED");
    expect(s).toBe("COMPLETED");
  });

  it("allows failure from SUBMITTED and from PROCESSING", () => {
    expect(transition("SUBMITTED", "FAILED")).toBe("FAILED");
    expect(transition("PROCESSING", "FAILED")).toBe("FAILED");
  });

  it("allows reversal from PROCESSING and from COMPLETED", () => {
    // A settled payment can still be charged back days later.
    expect(transition("PROCESSING", "REVERSED")).toBe("REVERSED");
    expect(transition("COMPLETED", "REVERSED")).toBe("REVERSED");
  });

  it("allows cancellation ONLY before submission", () => {
    expect(transition("CREATED", "CANCELLED")).toBe("CANCELLED");
    // After the request left, the client cannot promise it will not land.
    expect(canTransition("SUBMITTED", "CANCELLED")).toBe(false);
    expect(canTransition("PROCESSING", "CANCELLED")).toBe(false);
  });

  it("is idempotent for a re-delivered event", () => {
    // Webhooks and pollers redeliver. Seeing PROCESSING twice is not an error.
    expect(transition("PROCESSING", "PROCESSING")).toBe("PROCESSING");
  });

  it("throws on an illegal transition rather than clamping", () => {
    expect(() => transition("COMPLETED", "PROCESSING")).toThrow(IllegalTransitionError);
    expect(() => transition("FAILED", "COMPLETED")).toThrow(/FAILED -> COMPLETED/);
  });

  it("lets nothing escape a terminal failure state", () => {
    for (const from of ["FAILED", "REVERSED", "CANCELLED"] as TxState[]) {
      for (const to of TX_STATES) {
        if (to === from) continue;
        expect(canTransition(from, to)).toBe(false);
      }
    }
  });
});

describe("predicates", () => {
  it("treats SUBMITTED and PROCESSING as pending, not as outcomes", () => {
    expect(isPending("SUBMITTED")).toBe(true);
    expect(isPending("PROCESSING")).toBe(true);
    expect(isPending("COMPLETED")).toBe(false);
    expect(isPending("FAILED")).toBe(false);
  });

  it("only calls COMPLETED settled", () => {
    expect(isSettled("COMPLETED")).toBe(true);
    for (const s of TX_STATES.filter((x) => x !== "COMPLETED")) {
      expect(isSettled(s)).toBe(false);
    }
  });

  it("does not call COMPLETED terminal, because a chargeback can still land", () => {
    expect(isTerminalState("COMPLETED")).toBe(false);
    expect(isTerminalState("FAILED")).toBe(true);
    expect(isTerminalState("REVERSED")).toBe(true);
    expect(isTerminalState("CANCELLED")).toBe(true);
  });

  it("flags exactly the states where a retry could double-spend", () => {
    expect(requiresIdempotentRetry("SUBMITTED")).toBe(true);
    expect(requiresIdempotentRetry("PROCESSING")).toBe(true);
    expect(requiresIdempotentRetry("CREATED")).toBe(false);
    expect(requiresIdempotentRetry("FAILED")).toBe(false);
  });
});

describe("what the UI may offer", () => {
  it("offers retry ONLY from FAILED", () => {
    // Offering retry while SUBMITTED invites a second payment for one intent.
    expect(canUserRetry("FAILED")).toBe(true);
    for (const s of TX_STATES.filter((x) => x !== "FAILED")) {
      expect(canUserRetry(s)).toBe(false);
    }
  });

  it("offers cancel ONLY from CREATED", () => {
    expect(canUserCancel("CREATED")).toBe(true);
    for (const s of TX_STATES.filter((x) => x !== "CREATED")) {
      expect(canUserCancel(s)).toBe(false);
    }
  });

  it("never offers retry and cancel at the same time", () => {
    for (const s of TX_STATES) {
      expect(canUserRetry(s) && canUserCancel(s)).toBe(false);
    }
  });
});

describe("parseTxState", () => {
  it("accepts the canonical names", () => {
    for (const s of TX_STATES) expect(parseTxState(s)).toBe(s);
  });

  it("normalizes the aliases real backends emit", () => {
    expect(parseTxState("pending")).toBe("PROCESSING");
    expect(parseTxState("in-progress")).toBe("PROCESSING");
    expect(parseTxState("succeeded")).toBe("COMPLETED");
    expect(parseTxState("settled")).toBe("COMPLETED");
    expect(parseTxState("declined")).toBe("FAILED");
    expect(parseTxState("refunded")).toBe("REVERSED");
    expect(parseTxState("canceled")).toBe("CANCELLED"); // US spelling
  });

  it("returns null for an unknown status instead of guessing", () => {
    // Must never fall back to COMPLETED.
    expect(parseTxState("quantum_superposition")).toBeNull();
    expect(parseTxState("")).toBeNull();
    expect(parseTxState(null)).toBeNull();
    expect(parseTxState(undefined)).toBeNull();
  });

  it("never maps an unknown value onto a successful state", () => {
    const junk = ["ok", "done?", "200", "true", "yes", "finished-ish"];
    for (const j of junk) {
      const parsed = parseTxState(j);
      expect(parsed === "COMPLETED").toBe(false);
    }
  });
});

describe("presentation mapping", () => {
  it("maps every state to a badge without falling through", () => {
    for (const s of TX_STATES) {
      expect(typeof toMoneyStatus(s)).toBe("string");
      expect(toMoneyStatus(s).length).toBeGreaterThan(0);
    }
  });

  it("does not show SUBMITTED as a completed badge", () => {
    expect(toMoneyStatus("SUBMITTED")).not.toBe("completed");
    expect(toMoneyStatus("PROCESSING")).not.toBe("completed");
  });

  it("gives every state a distinct message key", () => {
    const keys = TX_STATES.map(statusMessageKey);
    expect(new Set(keys).size).toBe(TX_STATES.length);
  });
});
