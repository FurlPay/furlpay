import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  CLIENT_PLATFORM_HEADER,
  CLIENT_VERSION_HEADER,
  checkClientVersion,
  compareVersions,
  minimumVersions,
  parseVersion,
  retiredClientOr426,
} from "../clientVersion";

// ---------------------------------------------------------------------------
// Retiring a client, and the two ways that goes wrong.
//
// Too permissive: a build with a known client-side bug keeps moving money
// forever, because nothing ever read the version it has always been sending.
//
// Too strict: a misconfigured floor refuses every client, which on a payments
// app is a self-inflicted outage. So every ambiguous case here resolves to
// ALLOW, and only an unambiguous "read this version, it is below a floor we
// were told" refuses.
// ---------------------------------------------------------------------------

const saved = process.env.FURLPAY_MIN_CLIENT_VERSIONS;
beforeEach(() => delete process.env.FURLPAY_MIN_CLIENT_VERSIONS);
afterEach(() => {
  if (saved === undefined) delete process.env.FURLPAY_MIN_CLIENT_VERSIONS;
  else process.env.FURLPAY_MIN_CLIENT_VERSIONS = saved;
});

function policy(json: Record<string, string>) {
  process.env.FURLPAY_MIN_CLIENT_VERSIONS = JSON.stringify(json);
}

describe("parseVersion", () => {
  it("reads a plain version", () => {
    expect(parseVersion("1.4.2")).toEqual({ major: 1, minor: 4, patch: 2 });
  });

  it("tolerates a leading v and build metadata", () => {
    expect(parseVersion("v1.4.2+31")).toEqual({ major: 1, minor: 4, patch: 2 });
    expect(parseVersion("1.4.2-rc1")).toEqual({ major: 1, minor: 4, patch: 2 });
  });

  it("defaults a missing patch to zero", () => {
    expect(parseVersion("2.0")).toEqual({ major: 2, minor: 0, patch: 0 });
  });

  it("returns null rather than 0.0.0 for junk", () => {
    // The distinction that prevents a lockout: "could not read" must not
    // collapse into "older than everything".
    for (const junk of ["", "abc", null, undefined, "v", "..", 7 as never]) {
      expect(parseVersion(junk as string)).toBeNull();
    }
  });
});

describe("compareVersions", () => {
  it("orders by major, then minor, then patch", () => {
    const v = (s: string) => parseVersion(s)!;
    expect(compareVersions(v("1.4.2"), v("1.4.2"))).toBe(0);
    expect(compareVersions(v("1.4.1"), v("1.4.2"))).toBeLessThan(0);
    expect(compareVersions(v("1.5.0"), v("1.4.9"))).toBeGreaterThan(0);
    expect(compareVersions(v("2.0.0"), v("1.99.99"))).toBeGreaterThan(0);
  });

  it("does not compare version parts as strings", () => {
    // "10" < "9" lexically. The classic bug.
    const v = (s: string) => parseVersion(s)!;
    expect(compareVersions(v("1.10.0"), v("1.9.0"))).toBeGreaterThan(0);
  });
});

describe("minimumVersions", () => {
  it("is empty when unset, so the feature is inert", () => {
    expect(minimumVersions()).toEqual({});
  });

  it("ignores malformed JSON rather than refusing everyone", () => {
    process.env.FURLPAY_MIN_CLIENT_VERSIONS = "{not json";
    expect(minimumVersions()).toEqual({});
  });

  it("ignores unknown platforms and unparseable floors", () => {
    policy({ ios: "1.4.2", blackberry: "9.0.0", android: "not-a-version" });
    expect(minimumVersions()).toEqual({ ios: "1.4.2" });
  });
});

describe("checkClientVersion", () => {
  it("refuses a build below the floor", () => {
    policy({ ios: "1.4.2" });
    const v = checkClientVersion("ios", "1.4.1");
    expect(v.supported).toBe(false);
    if (!v.supported) {
      expect(v.minimum).toBe("1.4.2");
      expect(v.platform).toBe("ios");
    }
  });

  it("allows the floor itself and anything above", () => {
    policy({ ios: "1.4.2" });
    expect(checkClientVersion("ios", "1.4.2").supported).toBe(true);
    expect(checkClientVersion("ios", "1.4.3").supported).toBe(true);
    expect(checkClientVersion("ios", "2.0.0").supported).toBe(true);
  });

  it("is case-insensitive about the platform", () => {
    policy({ ios: "1.4.2" });
    expect(checkClientVersion("iOS", "1.4.1").supported).toBe(false);
  });

  it("only refuses the platform named in the policy", () => {
    policy({ ios: "1.4.2" });
    expect(checkClientVersion("android", "1.0.0").supported).toBe(true);
  });

  it("allows an unparseable client version", () => {
    // Odd builds send odd strings. A parsing bug must not lock anyone out.
    policy({ ios: "1.4.2" });
    expect(checkClientVersion("ios", "garbage").supported).toBe(true);
    expect(checkClientVersion("ios", null).supported).toBe(true);
  });

  it("allows everything when no policy is configured", () => {
    expect(checkClientVersion("ios", "0.0.1").supported).toBe(true);
  });

  it("allows a caller that sends no platform at all", () => {
    policy({ ios: "1.4.2" });
    expect(checkClientVersion(null, "1.0.0").supported).toBe(true);
  });

  it("can retire every platform at once", () => {
    policy({ ios: "2.0.0", android: "2.0.0", wearos: "2.0.0", web: "2.0.0" });
    for (const p of ["ios", "android", "wearos", "web"]) {
      expect(checkClientVersion(p, "1.9.9").supported).toBe(false);
    }
  });
});

describe("retiredClientOr426", () => {
  function headers(platform?: string, version?: string) {
    const h = new Headers();
    if (platform) h.set(CLIENT_PLATFORM_HEADER, platform);
    if (version) h.set(CLIENT_VERSION_HEADER, version);
    return h;
  }

  it("returns null for a supported client", () => {
    policy({ ios: "1.4.2" });
    expect(retiredClientOr426(headers("ios", "1.5.0"))).toBeNull();
  });

  it("returns 426 Upgrade Required, not a generic refusal", async () => {
    // 426 is actionable: the status alone tells an app what to show.
    policy({ ios: "1.4.2" });
    const res = retiredClientOr426(headers("ios", "1.0.0"));
    expect(res?.status).toBe(426);
    const body = await res!.json();
    expect(body.error).toBe("upgrade_required");
    expect(body.minimumVersion).toBe("1.4.2");
    expect(body.detail).toMatch(/1\.4\.2/);
  });

  it("does not refuse a request carrying no client headers", () => {
    // Server-to-server callers and the web app do not send these.
    policy({ ios: "1.4.2" });
    expect(retiredClientOr426(new Headers())).toBeNull();
  });
});
