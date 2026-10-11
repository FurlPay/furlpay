// P0-3 (audit 2026-10-05): freeRASP shipped with a placeholder identity
// (com.furlpay.mobile / TODO_CERT_HASH / YOUR_TEAM_ID, isProd: true) and a
// swallowed start failure. These pin the replacement rules.

jest.mock("expo-constants", () => ({ __esModule: true, default: { expoConfig: { extra: {} } } }));

import fs from "fs";
import path from "path";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { talsecStart, setThreatListeners } from "freerasp-react-native";
import {
  __resetTamperStateForTests,
  buildTalsecConfig,
  isDeviceCompromised,
  isIntegrityUnknown,
  startTamperDetection,
  tamperState,
} from "../tamperDetection";

const HASH = Buffer.alloc(32, 7).toString("base64"); // a well-formed base64 SHA-256
const ANDROID = { packageName: "com.furlpay.app", certificateHashes: [HASH], isProd: true };
const IOS = { appBundleId: "com.furlpay.app", appTeamId: "ABCDE12345", isProd: true };

const setExtra = (freerasp: unknown) => {
  (Constants as unknown as { expoConfig: { extra: Record<string, unknown> } }).expoConfig.extra = { freerasp };
};

const mockStart = talsecStart as jest.Mock;
const mockListeners = setThreatListeners as jest.Mock;

beforeEach(() => {
  __resetTamperStateForTests();
  mockStart.mockReset().mockResolvedValue(undefined);
  mockListeners.mockClear();
  jest.spyOn(console, "warn").mockImplementation(() => {});
  Platform.OS = "android";
});

describe("buildTalsecConfig", () => {
  it("accepts a real Android identity and passes it through unchanged", () => {
    const r = buildTalsecConfig(ANDROID, "android");
    expect(r.ok && r.config.androidConfig).toEqual({
      packageName: "com.furlpay.app",
      certificateHashes: [HASH],
      supportedAlternativeStores: [],
    });
    expect(r.ok && r.config.isProd).toBe(true);
  });

  it.each([
    ["the old placeholder hash", { ...ANDROID, certificateHashes: ["TODO_CERT_HASH"] }],
    ["no hashes", { ...ANDROID, certificateHashes: [] }],
    ["no package", { ...ANDROID, packageName: "" }],
    ["no config at all", null],
  ])("refuses an Android config with %s", (_label, raw) => {
    expect(buildTalsecConfig(raw as never, "android").ok).toBe(false);
  });

  it("refuses the old iOS placeholder team id", () => {
    expect(buildTalsecConfig({ ...IOS, appTeamId: "YOUR_TEAM_ID" }, "ios").ok).toBe(false);
    expect(buildTalsecConfig(IOS, "ios").ok).toBe(true);
  });

  it("isProd is only true when the build says so", () => {
    const r = buildTalsecConfig({ ...ANDROID, isProd: undefined }, "android");
    expect(r.ok && r.config.isProd).toBe(false);
  });
});

describe("startTamperDetection", () => {
  it("integrity is UNKNOWN before detection starts (fail closed → step-up)", () => {
    expect(isIntegrityUnknown()).toBe(true);
  });

  it("missing config → never starts freeRASP against a wrong identity, integrity stays unknown", async () => {
    setExtra(undefined);
    await startTamperDetection();
    expect(mockStart).not.toHaveBeenCalled();
    expect(isIntegrityUnknown()).toBe(true);
    expect(isDeviceCompromised()).toBe(false); // not a blanket block either
    expect(tamperState().status).toBe("unavailable");
  });

  it("start failure is NOT swallowed into a silent allow: integrity unknown", async () => {
    setExtra(ANDROID);
    mockStart.mockRejectedValueOnce(new Error("bad config"));
    await startTamperDetection();
    expect(isIntegrityUnknown()).toBe(true);
    expect(tamperState().reason).toMatch(/failed to start/);
  });

  it("a clean start makes integrity known", async () => {
    setExtra(ANDROID);
    await startTamperDetection();
    expect(mockStart).toHaveBeenCalledWith(
      expect.objectContaining({ androidConfig: expect.objectContaining({ packageName: "com.furlpay.app" }) })
    );
    expect(isIntegrityUnknown()).toBe(false);
  });

  it("tamper threats mark the device compromised; advisory ones do not", async () => {
    setExtra(ANDROID);
    await startTamperDetection();
    const actions = mockListeners.mock.calls[0][0] as Record<string, () => void>;
    actions.unofficialStore();
    actions.systemVPN();
    expect(isDeviceCompromised()).toBe(false);
    actions.hooks();
    expect(isDeviceCompromised()).toBe(true);
    expect(tamperState().threats).toEqual(expect.arrayContaining(["hooks", "unofficialStore"]));
  });
});

it("no placeholder identity survives in the source", () => {
  const src = fs.readFileSync(path.join(__dirname, "..", "tamperDetection.ts"), "utf8");
  const code = src.replace(/\/\/.*$/gm, "");
  expect(code).not.toMatch(/TODO_CERT_HASH|YOUR_TEAM_ID|com\.furlpay\.mobile/);
});
