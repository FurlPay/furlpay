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

/**
 * Which platform this build is for.
 *
 * EAS sets EAS_BUILD_PLATFORM on its workers; a local `expo prebuild -p ios`
 * sets neither, so the fallback is "any" and the checks below stay permissive.
 * This matters because the requirements genuinely DIFFER by platform, and a
 * gate that ignores that either blocks a valid iOS build over an Android file
 * or waves through an Android build with no push config.
 */
function buildPlatform() {
  const p = (process.env.EAS_BUILD_PLATFORM || "").toLowerCase();
  if (p === "ios" || p === "android") return p;
  return "any";
}

// ---------------------------------------------------------------------------
// Environment (dev | staging | prod)
//
// Before this existed there WAS no environment concept in the app: lib/api.ts
// read EXPO_PUBLIC_API_BASE and fell back to https://furlpay.com/api, eas.json
// declared no `env` block on any profile, and so a `development` build, a
// `preview` build handed to a tester and a store build all talked to the
// PRODUCTION backend. Every QA tap moved real money.
//
// The environment is resolved here, in the one file every build path goes
// through, and is the single source of three things that must agree or the
// build is broken in a way nothing catches at runtime:
//
//   apiBase        — which backend. Written into `extra` AND exported as
//                    EXPO_PUBLIC_API_BASE so lib/api.ts needs no change.
//   applicationId  — dev/staging get a suffix so all three can be installed on
//                    one device. Without it, installing a staging build
//                    UNINSTALLS the tester's production app and its Keystore
//                    entries, silently signing them out of the real account.
//   display name   — the tester has to be able to tell them apart on the home
//                    screen. An icon badge is not enough; the names differ.
//
// Deep links are deliberately NOT suffixed for non-prod: App Links / Universal
// Links verify against furlpay.com's assetlinks.json, which lists the
// production signing fingerprint only. A staging build claiming those links
// would either fail verification (Android) or hijack them (iOS, same team).
// ---------------------------------------------------------------------------

/** AWS environment this build targets. */
function buildEnv() {
  const raw = (process.env.FURLPAY_ENV || "").toLowerCase();
  if (raw === "dev" || raw === "staging" || raw === "prod") return raw;
  // An EAS profile name is the next-best signal when FURLPAY_ENV is unset.
  const profile = (process.env.EAS_BUILD_PROFILE || "").toLowerCase();
  if (profile === "production") return "prod";
  if (profile === "preview") return "staging";
  return "dev";
}

/** Backend for an environment. These hostnames are the `api_base_url` outputs
 *  of infra/aws/envs/<env> — if one changes there, it changes here. */
const API_BASE_BY_ENV = {
  dev: "https://api-dev.furlpay.com/api",
  staging: "https://api-staging.furlpay.com/api",
  prod: "https://api.furlpay.com/api",
};

const ENV_SUFFIX = { dev: ".dev", staging: ".staging", prod: "" };
const ENV_LABEL = { dev: "FurlPay Dev", staging: "FurlPay Staging", prod: "FurlPay" };

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
const REQUIRED_AUTH_ENV_ANDROID = [
  "EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID",
  "EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID",
];

/** iOS uses its own OAuth client id — an Android client id is rejected by
 *  Google with a redirect_uri_mismatch, which surfaces as a blank browser. */
const REQUIRED_AUTH_ENV_IOS = [
  "EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID",
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
  const platform = buildPlatform();

  const fatal = [];
  const waivable = [];
  // google-services.json configures FCM, which is the ANDROID push transport.
  // An iOS build does not read it and must not be blocked by its absence —
  // iOS push runs over APNs (see apps/web/src/lib/fcm.ts, which keeps the two
  // transports apart rather than posting APNs tokens to FCM).
  if (!googleServices && platform !== "ios") {
    fatal.push("GOOGLE_SERVICES_JSON (EAS file secret) or ./google-services.json");
  }
  const requiredAuth =
    platform === "ios" ? REQUIRED_AUTH_ENV_IOS : REQUIRED_AUTH_ENV_ANDROID;
  for (const key of requiredAuth) {
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

  // --- Environment wiring ---------------------------------------------------
  const env = buildEnv();
  const suffix = ENV_SUFFIX[env];

  // An explicit EXPO_PUBLIC_API_BASE still wins — a developer pointing a build
  // at a laptop (`http://192.168.1.5:3000/api`) is a real workflow. But a
  // RELEASE may not do that: shipping a store build aimed at anything other
  // than the production backend is the failure this whole block exists for.
  const override = process.env.EXPO_PUBLIC_API_BASE;
  if (release && override && override !== API_BASE_BY_ENV.prod) {
    throw new Error(
      `\n  Release build has EXPO_PUBLIC_API_BASE=${override}, which is not the ` +
        `production backend (${API_BASE_BY_ENV.prod}).\n  Unset it, or build a ` +
        `preview/development profile instead.\n`
    );
  }
  const apiBase = override || API_BASE_BY_ENV[env];

  // lib/api.ts reads process.env.EXPO_PUBLIC_API_BASE, which Expo inlines at
  // bundle time from whatever is set when the bundler runs. Setting it here
  // means the resolution above is authoritative for every build path without
  // touching the API client.
  process.env.EXPO_PUBLIC_API_BASE = apiBase;

  config.name = ENV_LABEL[env];
  config.extra = {
    ...config.extra,
    furlpayEnv: env,
    apiBase,
  };

  config.android = {
    ...config.android,
    package: `${config.android?.package ?? "com.furlpay.app"}${suffix}`,
  };
  config.ios = {
    ...config.ios,
    bundleIdentifier: `${config.ios?.bundleIdentifier ?? "com.furlpay.app"}${suffix}`,
  };

  // APNs environment. expo-notifications writes `aps-environment` from its
  // `mode` option, which DEFAULTS TO "development" — so without this every
  // build, the App Store one included, asked for sandbox push tokens, and the
  // production APNs gateway rejects those. Pushes carry 3DS2 approvals here,
  // so a sandbox token in a store build is a card that can never be approved.
  config.plugins = (config.plugins ?? []).map((p) => {
    const name = Array.isArray(p) ? p[0] : p;
    if (name !== "expo-notifications") return p;
    const opts = Array.isArray(p) ? p[1] ?? {} : {};
    return ["expo-notifications", { ...opts, mode: env === "prod" ? "production" : "development" }];
  });

  if (env !== "prod") {
    // App Links / Universal Links belong to production alone — see the header.
    // Leaving them on a non-prod build means Android silently fails
    // verification and iOS (same team id) can steal the association.
    delete config.android.intentFilters;
    delete config.ios.associatedDomains;
  }

  console.log(
    `[app.config] env=${env} api=${apiBase} android=${config.android.package} ios=${config.ios.bundleIdentifier}`
  );

  return config;
};
