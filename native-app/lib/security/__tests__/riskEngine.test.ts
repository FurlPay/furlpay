import {
  assessRisk,
  explainAssessment,
  forcesStepUp,
  isMoneyMoving,
  type RiskSignals,
} from "../riskEngine";

function signals(over: Partial<RiskSignals> = {}): RiskSignals {
  return {
    action: "send_funds",
    amountUsd: 50,
    deviceCompromised: false,
    integrityUnknown: false,
    knownBeneficiary: true,
    inAddressBook: true,
    transactionsLast24h: 2,
    amountLast24hUsd: 100,
    medianTransactionUsd: 60,
    failedAuthAttempts: 0,
    accountAgeDays: 365,
    newDevice: false,
    ...over,
  };
}

describe("the baseline", () => {
  it("allows an ordinary payment with no rules fired", () => {
    const a = assessRisk(signals());
    expect(a.decision).toBe("ALLOW");
    expect(a.rules).toEqual([]);
    expect(explainAssessment(a)).toBeNull();
  });

  it("does not fire money rules for a read-only action", () => {
    const a = assessRisk(signals({ action: "view_balance", knownBeneficiary: false, amountUsd: 0 }));
    expect(a.decision).toBe("ALLOW");
  });
});

describe("device integrity", () => {
  it("BLOCKS a money movement on a compromised device", () => {
    // Asking harder achieves nothing on a rooted phone — the prompt itself can
    // be bypassed.
    const a = assessRisk(signals({ deviceCompromised: true }));
    expect(a.decision).toBe("BLOCK");
    expect(a.rules[0].id).toBe("device_compromised");
  });

  it("only REVIEWs a non-money action on a compromised device", () => {
    const a = assessRisk(signals({ action: "change_profile", deviceCompromised: true }));
    expect(a.decision).toBe("REVIEW");
  });

  it("treats unverifiable integrity as step-up, not as compromise", () => {
    // Integrity checks fail on plenty of legitimate devices: no Play Services,
    // custom ROM, offline. Refusing those would lock out real users.
    const a = assessRisk(signals({ integrityUnknown: true }));
    expect(a.decision).toBe("STEP_UP");
    expect(a.rules[0].id).toBe("integrity_unknown");
  });
});

describe("authentication failures", () => {
  it("BLOCKS after repeated failures", () => {
    const a = assessRisk(signals({ failedAuthAttempts: 5 }));
    expect(a.decision).toBe("BLOCK");
    expect(a.rules[0].id).toBe("auth_failures");
  });

  it("steps up after a single failure on a money action", () => {
    const a = assessRisk(signals({ failedAuthAttempts: 1 }));
    expect(a.decision).toBe("STEP_UP");
  });

  it("ignores a single failure on a read-only action", () => {
    const a = assessRisk(signals({ action: "view_balance", failedAuthAttempts: 1 }));
    expect(a.decision).toBe("ALLOW");
  });
});

describe("new beneficiary", () => {
  it("always warns, even for a small amount", () => {
    // Sending to the wrong address is irreversible and is the most common way
    // money is lost here, so the warning is not gated on size.
    const a = assessRisk(signals({ knownBeneficiary: false, amountUsd: 1 }));
    expect(a.warnings.length).toBeGreaterThan(0);
    expect(a.decision).toBe("ALLOW"); // warn, do not obstruct
  });

  it("steps up for a large first payment", () => {
    const a = assessRisk(signals({ knownBeneficiary: false, amountUsd: 250 }));
    expect(a.decision).toBe("STEP_UP");
    expect(a.rules.some((r) => r.id === "new_beneficiary_large")).toBe(true);
  });

  it("says whether the destination is in the address book", () => {
    const known = assessRisk(signals({ knownBeneficiary: false, inAddressBook: true }));
    const unknown = assessRisk(signals({ knownBeneficiary: false, inAddressBook: false }));
    expect(known.warnings[0]).not.toContain("address book");
    expect(unknown.warnings[0]).toContain("address book");
  });
});

describe("amount anomaly", () => {
  it("steps up on a payment far above the user's own normal", () => {
    const a = assessRisk(signals({ medianTransactionUsd: 50, amountUsd: 600 }));
    expect(a.rules.some((r) => r.id === "amount_anomaly")).toBe(true);
  });

  it("does not fire at exactly the multiple", () => {
    const a = assessRisk(signals({ medianTransactionUsd: 50, amountUsd: 500 }));
    expect(a.rules.some((r) => r.id === "amount_anomaly")).toBe(false);
  });

  it("stays quiet for a brand-new account with no established normal", () => {
    // Firing "unusual for you" at someone with no history is noise, and it
    // would step up every one of a new user's first payments.
    const a = assessRisk(
      signals({ accountAgeDays: 1, medianTransactionUsd: 5, amountUsd: 400, knownBeneficiary: true })
    );
    expect(a.rules.some((r) => r.id === "amount_anomaly")).toBe(false);
  });

  it("stays quiet when there is no median at all", () => {
    const a = assessRisk(signals({ medianTransactionUsd: undefined, amountUsd: 10_000 }));
    expect(a.rules.some((r) => r.id === "amount_anomaly")).toBe(false);
  });
});

describe("velocity", () => {
  it("flags an implausible number of payments for review", () => {
    const a = assessRisk(signals({ transactionsLast24h: 21 }));
    expect(a.decision).toBe("REVIEW");
    expect(a.rules.some((r) => r.id === "velocity_count")).toBe(true);
  });

  it("counts the CURRENT payment toward the 24h total", () => {
    // 4,900 already moved + 200 now crosses 5,000. Excluding the current
    // payment would let the limit be walked past one payment at a time.
    const a = assessRisk(signals({ amountLast24hUsd: 4_900, amountUsd: 200 }));
    expect(a.rules.some((r) => r.id === "velocity_amount")).toBe(true);
  });

  it("does not fire below the daily total", () => {
    const a = assessRisk(signals({ amountLast24hUsd: 1_000, amountUsd: 100 }));
    expect(a.rules.some((r) => r.id === "velocity_amount")).toBe(false);
  });
});

describe("account standing", () => {
  it("reviews a large payment from a days-old account", () => {
    const a = assessRisk(signals({ accountAgeDays: 2, amountUsd: 500 }));
    expect(a.decision).toBe("REVIEW");
    expect(a.rules.some((r) => r.id === "young_account_large_amount")).toBe(true);
  });

  it("leaves a small payment from a young account alone", () => {
    const a = assessRisk(signals({ accountAgeDays: 2, amountUsd: 20 }));
    expect(a.decision).toBe("ALLOW");
  });

  it("steps up the first payment from a new device", () => {
    const a = assessRisk(signals({ newDevice: true }));
    expect(a.rules.some((r) => r.id === "new_device")).toBe(true);
  });
});

describe("severity resolution", () => {
  it("takes the strictest rule when several fire", () => {
    const a = assessRisk(
      signals({ newDevice: true, transactionsLast24h: 25, deviceCompromised: true })
    );
    expect(a.decision).toBe("BLOCK");
  });

  it("sorts the most severe rule first, so explanations lead with it", () => {
    const a = assessRisk(signals({ newDevice: true, transactionsLast24h: 25 }));
    expect(a.rules[0].contributes).toBe("REVIEW");
    expect(explainAssessment(a)).toContain("check this first");
  });

  it("never returns ALLOW while a rule is firing", () => {
    const a = assessRisk(signals({ newDevice: true }));
    expect(a.rules.length).toBeGreaterThan(0);
    expect(a.decision).not.toBe("ALLOW");
  });
});

describe("explainability", () => {
  it("names the actual value that tripped, not a generic reason", () => {
    const a = assessRisk(signals({ knownBeneficiary: false, amountUsd: 1234 }));
    const msg = explainAssessment(a)!;
    expect(msg).toContain("$1,234");
    // "for security reasons" trains users to click through warnings.
    expect(msg.toLowerCase()).not.toContain("security reasons");
  });

  it("gives every firing rule a human-readable detail", () => {
    const a = assessRisk(
      signals({ deviceCompromised: true, newDevice: true, transactionsLast24h: 30 })
    );
    for (const r of a.rules) {
      expect(r.detail.length).toBeGreaterThan(10);
      expect(r.detail).not.toContain("undefined");
      expect(r.id).toMatch(/^[a-z_]+$/);
    }
  });

  it("returns null for an allowed action", () => {
    expect(explainAssessment(assessRisk(signals()))).toBeNull();
  });
});

describe("privacy posture", () => {
  it("has no location, IP, contact-scraping or installed-app signal", () => {
    // Copying RedotPay's three fingerprinting stacks would be a privacy
    // regression sold as a security feature. The signal surface is the contract.
    const src = require("fs").readFileSync(
      require("path").join(__dirname, "..", "riskEngine.ts"),
      "utf8"
    );
    const iface = src.slice(
      src.indexOf("export interface RiskSignals"),
      src.indexOf("/** Severity ordering")
    );
    for (const forbidden of ["latitude", "longitude", "ipAddress", "geo", "contacts", "installedApps", "simSerial", "imei", "advertisingId"]) {
      expect(iface).not.toContain(forbidden);
    }
  });
});

describe("forcesStepUp", () => {
  it("is true for STEP_UP and REVIEW, false for ALLOW and BLOCK", () => {
    expect(forcesStepUp(assessRisk(signals({ newDevice: true })))).toBe(true);
    expect(forcesStepUp(assessRisk(signals({ transactionsLast24h: 25 })))).toBe(true);
    expect(forcesStepUp(assessRisk(signals()))).toBe(false);
    // BLOCK is not a step-up: there is nothing the user can do to proceed.
    expect(forcesStepUp(assessRisk(signals({ deviceCompromised: true })))).toBe(false);
  });
});

describe("isMoneyMoving", () => {
  it("covers every action that can move money", () => {
    for (const a of [
      "send_funds",
      "withdraw",
      "swap",
      "bank_transfer",
      "authorize_agent_spend",
      "approve_agent_transaction",
    ] as const) {
      expect(isMoneyMoving(a)).toBe(true);
    }
  });

  it("excludes read-only and settings actions", () => {
    for (const a of ["view_balance", "change_profile", "change_theme"] as const) {
      expect(isMoneyMoving(a)).toBe(false);
    }
  });
});
