// Server-driven mobile configuration (audit P2-11). A released app build cannot
// be recalled from users' phones; this is how a bad build is retired: raise the
// minimum version and the app shows a blocking "update required" screen.
//
// Every value comes from the environment so an operator can change it without
// a deploy of the clients. Malformed values fall back to "no restriction" and
// are reported, never guessed.

type Env = Record<string, string | undefined>;

const SEMVER = /^\d+\.\d+\.\d+$/;
const KNOWN_KILL_SWITCHES = ["send", "swap", "earn", "cards", "travel", "wallet_link"] as const;
export type KillSwitch = (typeof KNOWN_KILL_SWITCHES)[number];

export interface AppConfig {
  minimumVersion: { android: string | null; ios: string | null };
  forceUpdate: boolean;
  /** Features the client must hide/disable right now. */
  disabled: KillSwitch[];
  /** Operator message shown with a forced update or an outage banner. */
  message: string | null;
  invalid: string[];
}

export function appConfig(env: Env = process.env): AppConfig {
  const invalid: string[] = [];
  const version = (name: string): string | null => {
    const v = env[name]?.trim();
    if (!v) return null;
    if (!SEMVER.test(v)) {
      invalid.push(name);
      return null;
    }
    return v;
  };
  const minimumVersion = { android: version("FURLPAY_MIN_ANDROID_VERSION"), ios: version("FURLPAY_MIN_IOS_VERSION") };
  const disabled = (env.FURLPAY_APP_DISABLED_FEATURES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter((s): s is KillSwitch => {
      const ok = (KNOWN_KILL_SWITCHES as readonly string[]).includes(s);
      if (!ok) invalid.push(`FURLPAY_APP_DISABLED_FEATURES:${s}`);
      return ok;
    });
  return {
    minimumVersion,
    forceUpdate: env.FURLPAY_APP_FORCE_UPDATE === "1",
    disabled,
    message: env.FURLPAY_APP_MESSAGE?.trim().slice(0, 280) || null,
    invalid,
  };
}

/** Whether `current` is below `minimum` (both x.y.z). Used by clients and tests. */
export function belowMinimum(current: string, minimum: string | null): boolean {
  if (!minimum || !SEMVER.test(current) || !SEMVER.test(minimum)) return false;
  const a = current.split(".").map(Number);
  const b = minimum.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i];
  return false;
}
