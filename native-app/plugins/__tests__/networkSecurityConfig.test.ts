// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  NETWORK_SECURITY_CONFIG,
  NETWORK_SECURITY_CONFIG_DEBUG,
  assertPinsNotNearExpiry,
  PIN_EXPIRY_WARN_DAYS,
} = require("../withNetworkSecurityConfig");

// ---------------------------------------------------------------------------
// Release network-security configuration — FURL-006 and FURL-007.
//
// Both defects are the kind that produce no symptom. An expired <pin-set> is
// IGNORED by Android, so pinning silently stops applying; a dev-host cleartext
// exception in the release config is invisible until someone goes looking. A
// test is the only thing that notices either.
// ---------------------------------------------------------------------------

describe("release config forbids cleartext everywhere (FURL-007)", () => {
  it("carries no cleartext exception at all", () => {
    // The old release config permitted cleartext for localhost / 10.0.2.2 /
    // 127.0.0.1, justified in a comment as "harmless in release: these hosts
    // only exist on a developer machine". On a phone, localhost IS the device,
    // and a co-resident app can bind a port there.
    expect(NETWORK_SECURITY_CONFIG).not.toMatch(/cleartextTrafficPermitted="true"/);
  });

  it("names none of the dev hosts", () => {
    for (const host of ["localhost", "10.0.2.2", "127.0.0.1"]) {
      expect(NETWORK_SECURITY_CONFIG).not.toContain(host);
    }
  });

  it("keeps the base config denying cleartext", () => {
    expect(NETWORK_SECURITY_CONFIG).toMatch(
      /<base-config cleartextTrafficPermitted="false"\s*\/>/
    );
  });

  it("still pins furlpay.com — the fix must not remove pinning", () => {
    expect(NETWORK_SECURITY_CONFIG).toContain("furlpay.com");
    expect(NETWORK_SECURITY_CONFIG).toMatch(/<pin-set expiration="\d{4}-\d{2}-\d{2}">/);
    // More than one anchor: a single pin means one CA rotation bricks the app.
    const pins = NETWORK_SECURITY_CONFIG.match(/<pin digest="SHA-256">/g) || [];
    expect(pins.length).toBeGreaterThanOrEqual(2);
  });
});

describe("debug config carries the exception, and only it", () => {
  it("permits cleartext for the dev hosts", () => {
    expect(NETWORK_SECURITY_CONFIG_DEBUG).toMatch(/cleartextTrafficPermitted="true"/);
    for (const host of ["localhost", "10.0.2.2", "127.0.0.1"]) {
      expect(NETWORK_SECURITY_CONFIG_DEBUG).toContain(host);
    }
  });

  it("still pins the production domain in debug builds", () => {
    // The relaxation is scoped to the dev hosts, not to production: a debug
    // build talking to the real furlpay.com is still pinned.
    expect(NETWORK_SECURITY_CONFIG_DEBUG).toContain("furlpay.com");
    expect(NETWORK_SECURITY_CONFIG_DEBUG).toMatch(/<pin-set/);
  });

  it("denies cleartext by default even in debug", () => {
    expect(NETWORK_SECURITY_CONFIG_DEBUG).toMatch(
      /<base-config cleartextTrafficPermitted="false"\s*\/>/
    );
  });

  it("pins the same anchors as release", () => {
    // Divergent pin sets would mean debug builds validate a chain release
    // rejects, which is how a bad pin reaches production unnoticed.
    const pins = (xml: string) =>
      (xml.match(/<pin digest="SHA-256">([^<]+)<\/pin>/g) || []).sort();
    expect(pins(NETWORK_SECURITY_CONFIG_DEBUG)).toEqual(pins(NETWORK_SECURITY_CONFIG));
  });
});

describe("pin expiry is a build failure, not a silent lapse (FURL-006)", () => {
  it("passes today and reports the remaining window", () => {
    const daysLeft = assertPinsNotNearExpiry();
    expect(typeof daysLeft).toBe("number");
    expect(daysLeft).toBeGreaterThan(0);
  });

  it("declares an expiry date at all", () => {
    expect(NETWORK_SECURITY_CONFIG).toMatch(/expiration="\d{4}-\d{2}-\d{2}"/);
  });

  it("warns rather than throws inside the rotation window", () => {
    // Below the threshold the build must still succeed — a hard failure here
    // would block an incident hotfix over a pin that is still valid.
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const daysLeft = assertPinsNotNearExpiry(Date.now());
      if (daysLeft < PIN_EXPIRY_WARN_DAYS) expect(warn).toHaveBeenCalled();
      else expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it("THROWS once the pins have expired", () => {
    // The property that matters: an expired pin-set must never build quietly.
    const match = /expiration="(\d{4}-\d{2}-\d{2})"/.exec(NETWORK_SECURITY_CONFIG)!;
    const dayAfterExpiry = Date.parse(match[1]) + 86_400_000;
    expect(() => assertPinsNotNearExpiry(dayAfterExpiry)).toThrow(/EXPIRED/);
  });

  it("warns when inside the rotation window", () => {
    const match = /expiration="(\d{4}-\d{2}-\d{2})"/.exec(NETWORK_SECURITY_CONFIG)!;
    // One day inside the window.
    const inWindow = Date.parse(match[1]) - (PIN_EXPIRY_WARN_DAYS - 1) * 86_400_000;
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    try {
      expect(() => assertPinsNotNearExpiry(inWindow)).not.toThrow();
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
