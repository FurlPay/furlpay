import { describe, expect, it } from "vitest";
import { appConfig, belowMinimum } from "../appConfig";

// T-M7 (audit P2-11): a bad mobile build can be retired from the server.

describe("appConfig", () => {
  it("defaults to no restriction", () => {
    expect(appConfig({})).toEqual({
      minimumVersion: { android: null, ios: null },
      forceUpdate: false,
      disabled: [],
      message: null,
      invalid: [],
    });
  });

  it("reads minimum versions, force flag, kill switches and message", () => {
    const c = appConfig({
      FURLPAY_MIN_ANDROID_VERSION: "2.3.0",
      FURLPAY_MIN_IOS_VERSION: "1.0.1",
      FURLPAY_APP_FORCE_UPDATE: "1",
      FURLPAY_APP_DISABLED_FEATURES: "send, swap",
      FURLPAY_APP_MESSAGE: "Please update",
    });
    expect(c).toMatchObject({ minimumVersion: { android: "2.3.0", ios: "1.0.1" }, forceUpdate: true, disabled: ["send", "swap"], message: "Please update" });
  });

  it("reports malformed values instead of guessing", () => {
    const c = appConfig({ FURLPAY_MIN_ANDROID_VERSION: "latest", FURLPAY_APP_DISABLED_FEATURES: "send,everything" });
    expect(c.minimumVersion.android).toBeNull();
    expect(c.disabled).toEqual(["send"]);
    expect(c.invalid).toEqual(["FURLPAY_MIN_ANDROID_VERSION", "FURLPAY_APP_DISABLED_FEATURES:everything"]);
  });
});

describe("belowMinimum", () => {
  it.each([
    ["2.2.0", "2.3.0", true],
    ["2.3.0", "2.3.0", false],
    ["2.10.0", "2.9.9", false],
    ["1.9.9", "2.0.0", true],
    ["2.3.0", null, false],
    ["garbage", "2.0.0", false],
  ])("%s below %s → %s", (cur, min, want) => {
    expect(belowMinimum(cur, min)).toBe(want);
  });
});
