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
    const out = evaluate({
      EAS_BUILD_PROFILE: "production",
      GOOGLE_SERVICES_JSON: GOOGLE_SERVICES,
      ...AUTH_ENV,
    });
    expect(out.android?.googleServicesFile).toBe(GOOGLE_SERVICES);
  });

  it("falls back to the local google-services.json on a developer machine", () => {
    const out = evaluate({ EAS_BUILD_PROFILE: "production", ...AUTH_ENV });
    expect(out.android?.googleServicesFile).toBe("./google-services.json");
  });
});
