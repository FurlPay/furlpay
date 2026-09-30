import path from "path";

// ---------------------------------------------------------------------------
// The APNs environment follows the build environment.
//
// expo-notifications writes `aps-environment` from its `mode` option, which
// defaults to "development". app.json never set it, so every iOS build —
// including a store build — asked for sandbox push tokens, which production
// APNs rejects. Pushes carry 3DS2 approvals. Runs the REAL app.config.js with
// FURLPAY_ENV set (not a release build, so the credential guards stay out of
// the way).
// ---------------------------------------------------------------------------

const CONFIG = path.join(__dirname, "..", "..", "app.config.js");

type Plugin = string | [string, Record<string, unknown>];

function pluginsFor(env: string): Plugin[] {
  const saved = { FURLPAY_ENV: process.env.FURLPAY_ENV, EAS_BUILD_PROFILE: process.env.EAS_BUILD_PROFILE };
  process.env.FURLPAY_ENV = env;
  delete process.env.EAS_BUILD_PROFILE;
  try {
    delete require.cache[require.resolve(CONFIG)];
    const build = require(CONFIG) as (a: { config: Record<string, unknown> }) => { plugins: Plugin[] };
    return build({
      config: {
        android: {},
        ios: {},
        plugins: [["expo-notifications", { icon: "./x.png", defaultChannel: "approvals" }], "expo-router"],
      },
    }).plugins;
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

function notificationsMode(env: string): unknown {
  const entry = pluginsFor(env).find((p) => Array.isArray(p) && p[0] === "expo-notifications") as
    | [string, Record<string, unknown>]
    | undefined;
  return entry?.[1].mode;
}

describe("aps-environment", () => {
  it("is production for the prod build", () => {
    expect(notificationsMode("prod")).toBe("production");
  });

  it("is development for dev and staging", () => {
    expect(notificationsMode("dev")).toBe("development");
    expect(notificationsMode("staging")).toBe("development");
  });

  it("keeps the plugin's other options and leaves other plugins alone", () => {
    const plugins = pluginsFor("prod");
    expect(plugins).toContain("expo-router");
    const [, opts] = plugins.find((p) => Array.isArray(p) && p[0] === "expo-notifications") as [string, Record<string, unknown>];
    expect(opts.defaultChannel).toBe("approvals");
  });
});
