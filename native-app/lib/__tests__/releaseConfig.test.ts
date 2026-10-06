import fs from "fs";
import path from "path";

// ---------------------------------------------------------------------------
// A production build MUST NOT be able to silently omit Firebase (FCM) or the
// federated-auth client ids.
//
// This is the regression test for a real, shipped-and-invisible failure mode:
// google-services.json is gitignored, EAS Build uploads via git, so the file was
// absent on the worker; app.config.js used to check fs.existsSync() and just
// skip it. The build went green and produced an app where push was dead —
// silently, because lib/push.ts fails soft by design.
//
// Runs the REAL app.config.js.
// ---------------------------------------------------------------------------

const ROOT = path.join(__dirname, "..", "..");
const CONFIG = path.join(ROOT, "app.config.js");
const GOOGLE_SERVICES = path.join(ROOT, "google-services.json");

const ENV_KEYS = [
  "EAS_BUILD_PROFILE",
  "FURLPAY_RELEASE_BUILD",
  "FURLPAY_ENV",
  "EXPO_PUBLIC_API_BASE",
  "FURLPAY_FREERASP_CERT_HASHES",
  "FURLPAY_APPLE_TEAM_ID",
  "EAS_BUILD_PLATFORM",
  "GOOGLE_SERVICES_JSON",
  "EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID",
  "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID",
];

type Cfg = (arg: { config: Record<string, unknown> }) => { android?: { googleServicesFile?: string } };

function loadConfig(): Cfg {
  delete require.cache[require.resolve(CONFIG)];
  return require(CONFIG) as Cfg;
}

const evaluate = (env: Record<string, string>) => {
  for (const k of ENV_KEYS) delete process.env[k];
  Object.assign(process.env, env);
  return loadConfig()({ config: { android: {} } });
};

// Real Google OAuth client ids end in .apps.googleusercontent.com; the release
// guard rejects anything else (a placeholder would ship a dead sign-in button).
const AUTH_ENV = {
  EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID: "111-android.apps.googleusercontent.com",
  EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: "111-web.apps.googleusercontent.com",
  // freeRASP signing identity — required for a release since P0-3. Public
  // property of a signed app, not a secret. Colon-hex, as Play Console shows it.
  FURLPAY_FREERASP_CERT_HASHES: Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, "0").toUpperCase()).join(":"),
};

/** Reproduce an EAS worker faithfully: the gitignored file is not in the
 *  uploaded archive, so it does not exist on disk at all. */
function withoutGoogleServices<T>(fn: () => T): T {
  const hidden = `${GOOGLE_SERVICES}.hidden`;
  const existed = fs.existsSync(GOOGLE_SERVICES);
  if (existed) fs.renameSync(GOOGLE_SERVICES, hidden);
  try {
    return fn();
  } finally {
    if (existed) fs.renameSync(hidden, GOOGLE_SERVICES);
  }
}

/** The opposite case: a developer machine, where the gitignored file DOES
 *  exist. CI checkouts never have it (it is gitignored), so the two tests
 *  that need it failed on every CI run. A placeholder is created only when no
 *  real file is present, is never written over a real one, and is removed in
 *  `finally`. Its content is deliberately not a valid Firebase config, so a
 *  stray copy could not be mistaken for a real one by a release build. */
function withGoogleServices<T>(fn: () => T): T {
  if (fs.existsSync(GOOGLE_SERVICES)) return fn();
  fs.writeFileSync(GOOGLE_SERVICES, JSON.stringify({ _releaseConfigTestPlaceholder: true }), { flag: "wx" });
  try {
    return fn();
  } finally {
    fs.rmSync(GOOGLE_SERVICES, { force: true });
  }
}

const originalEnv = { ...process.env };
afterEach(() => {
  process.env = { ...originalEnv };
});

describe("release build configuration guard", () => {
  it("FAILS an EAS production build with no Firebase config — the silent-push-death scenario", () => {
    withoutGoogleServices(() => {
      expect(() => evaluate({ EAS_BUILD_PROFILE: "production", ...AUTH_ENV })).toThrow(
        /missing required configuration[\s\S]*GOOGLE_SERVICES_JSON/i
      );
    });
  });

  it("FAILS an EAS production build whose file secret does not resolve", () => {
    withoutGoogleServices(() => {
      expect(() =>
        evaluate({
          EAS_BUILD_PROFILE: "production",
          GOOGLE_SERVICES_JSON: "/nonexistent/google-services.json",
          ...AUTH_ENV,
        })
      ).toThrow(/GOOGLE_SERVICES_JSON/);
    });
  });

  it("FAILS a production build missing the federated-auth client ids", () => {
    expect(() => evaluate({ EAS_BUILD_PROFILE: "production" })).toThrow(
      /EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID/
    );
  });

  it("FAILS a production build with PLACEHOLDER client ids — a visible-but-dead Google button", () => {
    expect(() =>
      evaluate({
        EAS_BUILD_PROFILE: "production",
        EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID: "placeholder-android-client-id",
        EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: "placeholder-web-client-id",
      })
    ).toThrow(/placeholder|apps\.googleusercontent\.com/i);
  });

  it("FAILS the local signed-AAB path too (build-android.sh sets FURLPAY_RELEASE_BUILD)", () => {
    withoutGoogleServices(() => {
      expect(() => evaluate({ FURLPAY_RELEASE_BUILD: "1", ...AUTH_ENV })).toThrow(
        /missing required configuration/i
      );
    });
  });

  it("never prints a secret VALUE in the failure — only the missing key's name", () => {
    let message = "";
    withoutGoogleServices(() => {
      try {
        evaluate({ EAS_BUILD_PROFILE: "production", EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: "s3cret-value" });
      } catch (e) {
        message = (e as Error).message;
      }
    });
    expect(message).toMatch(/EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID/);
    expect(message).not.toContain("s3cret-value");
  });

  it("allows a dev build without config (warns, does not throw)", () => {
    withoutGoogleServices(() => {
      const out = evaluate({});
      expect(out.android?.googleServicesFile).toBeUndefined();
    });
  });

  it("wires googleServicesFile from the EAS file secret when it resolves", () => {
    const out = withGoogleServices(() =>
      evaluate({
        EAS_BUILD_PROFILE: "production",
        GOOGLE_SERVICES_JSON: GOOGLE_SERVICES,
        ...AUTH_ENV,
      })
    );
    expect(out.android?.googleServicesFile).toBe(GOOGLE_SERVICES);
  });

  it("falls back to the local google-services.json on a developer machine", () => {
    const out = withGoogleServices(() => evaluate({ EAS_BUILD_PROFILE: "production", ...AUTH_ENV }));
    expect(out.android?.googleServicesFile).toBe("./google-services.json");
  });
});

// ---------------------------------------------------------------------------
// P0-2 (audit 2026-10-05): every release was built against api.furlpay.com,
// which does not resolve. A release must talk to exactly the production base,
// and must not resolve to a non-prod environment by omission.
// ---------------------------------------------------------------------------
describe("release build API host", () => {
  type Extra = { extra?: { apiBase?: string; furlpayEnv?: string } };
  const mod = () => require(CONFIG) as { PRODUCTION_API_BASE: string; assertReleaseApiBase: (u: string) => string };
  const GS = { GOOGLE_SERVICES_JSON: GOOGLE_SERVICES };

  it("production resolves to https://furlpay.com/api — a host that exists, not api.furlpay.com", () => {
    const out = evaluate({ EAS_BUILD_PROFILE: "production", ...AUTH_ENV, ...GS }) as Extra;
    expect(out.extra?.apiBase).toBe("https://furlpay.com/api");
    expect(mod().PRODUCTION_API_BASE).toBe("https://furlpay.com/api");
  });

  it("FAILS a local signed release with no FURLPAY_ENV instead of building against dev", () => {
    expect(() => evaluate({ FURLPAY_RELEASE_BUILD: "1", ...AUTH_ENV, ...GS })).toThrow(/environment "dev", not "prod"/);
  });

  it("FAILS a release that explicitly asks for staging", () => {
    expect(() =>
      evaluate({ FURLPAY_RELEASE_BUILD: "1", FURLPAY_ENV: "staging", ...AUTH_ENV, ...GS })
    ).toThrow(/not "prod"/);
  });

  it("builds a local signed release with FURLPAY_ENV=prod (what build-android.sh now exports)", () => {
    const out = evaluate({ FURLPAY_RELEASE_BUILD: "1", FURLPAY_ENV: "prod", ...AUTH_ENV, ...GS }) as Extra;
    expect(out.extra?.apiBase).toBe("https://furlpay.com/api");
    expect(fs.readFileSync(path.join(ROOT, "build-android.sh"), "utf8")).toMatch(/^export FURLPAY_ENV=prod$/m);
  });

  it.each([
    "http://localhost:3000/api",
    "http://192.168.1.5:3000/api",
    "https://web-abc123-team.vercel.app/api",
    "https://api-staging.furlpay.com/api",
    "https://api.furlpay.com/api",
    "http://furlpay.com/api",
    "https://furlpay.com/api/",
  ])("FAILS a release whose EXPO_PUBLIC_API_BASE is %s", (base) => {
    expect(() =>
      evaluate({ EAS_BUILD_PROFILE: "production", EXPO_PUBLIC_API_BASE: base, ...AUTH_ENV, ...GS })
    ).toThrow(/not the production backend/);
    expect(() => mod().assertReleaseApiBase(base)).toThrow();
  });

  it("still lets a DEV build point at a laptop (the override is a real workflow)", () => {
    const out = evaluate({ EXPO_PUBLIC_API_BASE: "http://192.168.1.5:3000/api" }) as Extra;
    expect(out.extra?.apiBase).toBe("http://192.168.1.5:3000/api");
  });
});

// ---------------------------------------------------------------------------
// P0-3 (audit 2026-10-05): freeRASP ran against a placeholder identity.
// ---------------------------------------------------------------------------
describe("release build freeRASP identity", () => {
  type Rasp = { extra?: { freerasp?: { packageName: string; appBundleId: string; certificateHashes: string[]; appTeamId: string | null; isProd: boolean } } };
  const GS = { GOOGLE_SERVICES_JSON: GOOGLE_SERVICES };
  const { FURLPAY_FREERASP_CERT_HASHES: _omit, ...AUTH_NO_RASP } = AUTH_ENV;

  it("FAILS an Android release with no signing certificate hash", () => {
    expect(() => evaluate({ EAS_BUILD_PROFILE: "production", ...AUTH_NO_RASP, ...GS })).toThrow(
      /FURLPAY_FREERASP_CERT_HASHES/
    );
  });

  it("FAILS an Android release whose hash is the old placeholder", () => {
    expect(() =>
      evaluate({ EAS_BUILD_PROFILE: "production", ...AUTH_NO_RASP, ...GS, FURLPAY_FREERASP_CERT_HASHES: "TODO_CERT_HASH" })
    ).toThrow(/not a SHA-256 digest/);
  });

  it("FAILS an iOS release with no Apple Team ID, and with the old placeholder", () => {
    const ios = {
      EAS_BUILD_PROFILE: "production",
      EAS_BUILD_PLATFORM: "ios",
      EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID: "111-ios.apps.googleusercontent.com",
      EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID: "111-web.apps.googleusercontent.com",
    };
    expect(() => evaluate(ios)).toThrow(/FURLPAY_APPLE_TEAM_ID/);
    expect(() => evaluate({ ...ios, FURLPAY_APPLE_TEAM_ID: "YOUR_TEAM_ID" })).toThrow(/FURLPAY_APPLE_TEAM_ID/);
  });

  it("writes the RESOLVED identity and a base64 hash into extra.freerasp, isProd only for a prod release", () => {
    const out = evaluate({ EAS_BUILD_PROFILE: "production", ...AUTH_ENV, ...GS }) as Rasp;
    const rasp = out.extra!.freerasp!;
    expect(rasp.packageName).toBe("com.furlpay.app");
    expect(rasp.certificateHashes).toEqual([Buffer.from(Array.from({ length: 32 }, (_, i) => i)).toString("base64")]);
    expect(rasp.isProd).toBe(true);
  });

  it("a dev build carries its own suffixed identity and isProd false", () => {
    const out = evaluate({}) as Rasp;
    expect(out.extra!.freerasp!.packageName).toBe("com.furlpay.app.dev");
    expect(out.extra!.freerasp!.isProd).toBe(false);
  });

  it("the old hardcoded placeholder identity is gone from the runtime module", () => {
    const src = fs.readFileSync(path.join(ROOT, "lib", "security", "tamperDetection.ts"), "utf8").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/TODO_CERT_HASH|YOUR_TEAM_ID|com\.furlpay\.mobile/);
  });
});
