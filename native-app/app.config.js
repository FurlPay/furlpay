const fs = require("fs");
const path = require("path");

// ---------------------------------------------------------------------------
// Layered on top of app.json. This file is the ONE choke point every build goes
// through — `expo prebuild`, `eas build`, and build-android.sh — so it is where
// we refuse to produce a release that is quietly missing its Firebase or
// federated-auth configuration.
//
// THE BUG THIS EXISTS TO KILL:
//   google-services.json is gitignored (it is per-project config, and the repo
//   keeps it out of version control). EAS Build uploads the project via git and
//   honours .gitignore, so on an EAS worker the file simply is not there. The
//   previous version of this file did `if (fs.existsSync(...))` and shrugged —
//   producing an app with no Firebase, where getDevicePushTokenAsync() throws,
//   registerForPush() returns false by design, and PUSH IS SILENTLY DEAD. The
//   build went green. Nobody found out until a 3DS2 approval never arrived.
//
// The fix is not to commit the file. It is to source it from an EAS file secret
// and make its ABSENCE FATAL for a release build:
//
//   eas secret:create --scope project --type file \
//     --name GOOGLE_SERVICES_JSON --value ./google-services.json
//
//   eas secret:create --scope project --name EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID --value <id>
//   eas secret:create --scope project --name EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID     --value <id>
//   eas secret:create --scope project --name EXPO_PUBLIC_APPLE_CLIENT_ID          --value <services-id>
//
// EAS exposes a file secret as an env var holding the PATH to the file on the
// worker; locally the file sits at ./google-services.json. Both are handled.
// Nothing secret is ever printed: we report WHICH key is missing, never a value.
// ---------------------------------------------------------------------------

/** A release build is one whose artifact could reach a real user. */
function isReleaseBuild() {
  // EAS sets these on its workers.
  if (process.env.EAS_BUILD_PROFILE === "production") return true;
  // build-android.sh sets this for the local signed-AAB path.
  if (process.env.FURLPAY_RELEASE_BUILD === "1") return true;
  return false;
}

/** Client ids the federated sign-in buttons need. Absent => the button hides
 *  itself (lib/oauth.ts googleConfigured), which on a release build means we
 *  would ship an app whose Google/Apple sign-in silently does not exist. */
const REQUIRED_AUTH_ENV = [
  "EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID",
  "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID",
];

function resolveGoogleServices() {
  // 1. EAS file secret — the value is a path on the build worker.
  const fromSecret = process.env.GOOGLE_SERVICES_JSON;
  if (fromSecret && fs.existsSync(fromSecret)) return fromSecret;

  // 2. Local checkout (gitignored; present on a developer machine).
  const local = path.join(__dirname, "google-services.json");
  if (fs.existsSync(local)) return "./google-services.json";

  return null;
}

module.exports = ({ config }) => {
  const googleServices = resolveGoogleServices();
  const release = isReleaseBuild();
  // Explicit, recorded opt-out for a release built when federated (Google/Apple)
  // sign-in is deliberately NOT provisioned — e.g. no OAuth client exists for
  // the project yet. The buttons hide themselves at runtime (lib/oauth.ts), so
  // this ships the honest state, not a broken one. FCM/push is NOT waivable:
  // 3DS2 approvals depend on it, so a missing google-services.json stays fatal.
  const allowNoGoogle = process.env.FURLPAY_ALLOW_NO_GOOGLE === "1";

  // fatal: never waivable (push). waivable: federated sign-in, opt-out-able.
  const fatal = [];
  const waivable = [];
  if (!googleServices) fatal.push("GOOGLE_SERVICES_JSON (EAS file secret) or ./google-services.json");
  for (const key of REQUIRED_AUTH_ENV) {
    const value = process.env[key];
    if (!value) {
      waivable.push(key);
    } else if (release && !/\.apps\.googleusercontent\.com$/.test(value)) {
      // A visible Google button backed by a placeholder client id is worse than
      // no button: it renders, the user taps it, and Google rejects the request.
      // Real Google OAuth client ids always end in .apps.googleusercontent.com —
      // refuse anything else (e.g. "placeholder-android-client-id") in a release.
      waivable.push(`${key} (must be a real *.apps.googleusercontent.com client id, got a placeholder)`);
    }
  }

  const blocking = allowNoGoogle ? fatal : [...fatal, ...waivable];
  if (release && blocking.length) {
    // FAIL THE BUILD. A release missing push config (or federated sign-in, when
    // not explicitly waived) is not a degraded release, it is a broken one:
    // both fail silently at runtime by design.
    throw new Error(
      [
        "",
        "  Release build is missing required configuration:",
        ...blocking.map((m) => `    - ${m}`),
        "",
        "  Configure them once with:",
        "    eas secret:create --scope project --type file \\",
        "      --name GOOGLE_SERVICES_JSON --value ./google-services.json",
        "    eas secret:create --scope project --name EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID --value <id>",
        "    eas secret:create --scope project --name EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID --value <id>",
        "",
        "  Or, if federated sign-in is intentionally not provisioned yet, build with",
        "  FURLPAY_ALLOW_NO_GOOGLE=1 (the Google/Apple buttons hide themselves).",
        "  See native-app/README.md — 'Release configuration'.",
        "",
      ].join("\n")
    );
  }

  if (release && allowNoGoogle && waivable.length) {
    // A release WITH the waiver: loud, so it's never a silent surprise that the
    // shipped app has no federated sign-in.
    console.warn(
      `[app.config] FURLPAY_ALLOW_NO_GOOGLE=1 — building a RELEASE with federated ` +
        `sign-in DISABLED (${waivable.join(", ")}). Google/Apple buttons will be hidden; ` +
        "email OTP, passkeys and Apple-less flows still work."
    );
  } else if (!release && (fatal.length || waivable.length)) {
    // Dev/preview: permissive, but never silent. These are exactly the failures
    // that are invisible at runtime, so say so at build time.
    console.warn(
      `[app.config] non-release build missing: ${[...fatal, ...waivable].join(", ")} — ` +
        "push and/or federated sign-in will be inactive in this build."
    );
  }

  if (googleServices) {
    config.android = { ...config.android, googleServicesFile: googleServices };
  }
  return config;
};
