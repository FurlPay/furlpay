import { isInFlight, isTerminal, parseStatus, type MoneyStatus } from "../Status";

// The status machine decides whether a user is told their money is safe, gone,
// or still moving. These are the rules that must not drift.

const ALL: MoneyStatus[] = [
  "pending",
  "processing",
  "queued",
  "completed",
  "settled",
  "confirmed",
  "failed",
  "declined",
  "cancelled",
  "expired",
  "reversed",
  "escrow",
  "frozen",
  "active",
];

describe("parseStatus", () => {
  it("accepts every known status", () => {
    for (const s of ALL) expect(parseStatus(s)).toBe(s);
  });

  it("normalizes case and whitespace from the API", () => {
    expect(parseStatus("COMPLETED")).toBe("completed");
    expect(parseStatus("  Pending ")).toBe("pending");
  });

  it("returns null for an unknown status rather than guessing", () => {
    // The critical rule. Rendering an unrecognized state as "completed" would
    // tell a user their money arrived when the client has no idea whether it
    // did — the worst available failure mode here.
    expect(parseStatus("teleported")).toBeNull();
    expect(parseStatus("")).toBeNull();
    expect(parseStatus(null)).toBeNull();
    expect(parseStatus(undefined)).toBeNull();
  });
});

describe("isInFlight", () => {
  it("is true only while the outcome can still change", () => {
    expect(isInFlight("pending")).toBe(true);
    expect(isInFlight("processing")).toBe(true);
    expect(isInFlight("queued")).toBe(true);
  });

  it("is false for anything settled or failed", () => {
    for (const s of ["completed", "settled", "confirmed", "failed", "declined", "cancelled"] as const) {
      expect(isInFlight(s)).toBe(false);
    }
  });
});

describe("isTerminal", () => {
  it("is true for every final outcome", () => {
    for (const s of [
      "completed",
      "settled",
      "confirmed",
      "failed",
      "declined",
      "cancelled",
      "expired",
      "reversed",
    ] as const) {
      expect(isTerminal(s)).toBe(true);
    }
  });

  it("is false while in flight", () => {
    for (const s of ["pending", "processing", "queued"] as const) {
      expect(isTerminal(s)).toBe(false);
    }
  });

  it("is false for holding states, which are not payment outcomes", () => {
    // A frozen card and an escrowed payment are states of a THING, not the
    // result of a transfer. Treating them as terminal would stop the UI from
    // ever updating them.
    expect(isTerminal("escrow")).toBe(false);
    expect(isTerminal("frozen")).toBe(false);
    expect(isTerminal("active")).toBe(false);
  });
});

describe("the two predicates together", () => {
  it("never claims a status is both in-flight and terminal", () => {
    for (const s of ALL) {
      expect(isInFlight(s) && isTerminal(s)).toBe(false);
    }
  });

  it("classifies `reversed` as terminal but not successful", () => {
    // Money came back. It is over, but it is not a completed payment, and the
    // UI must not colour it like one.
    expect(isTerminal("reversed")).toBe(true);
    expect(isInFlight("reversed")).toBe(false);
  });
});
