import * as fs from "fs";
import * as path from "path";
import { ApiError } from "../api";
import { isStepUpRequired, parseOtp, safeReturnPath } from "../stepUp";

describe("isStepUpRequired", () => {
  it("recognises the server's step-up refusal and nothing else", () => {
    expect(isStepUpRequired(new ApiError(401, "x", { error: "step_up_required" }))).toBe(true);
    expect(isStepUpRequired(new ApiError(401, "x", { error: "Unauthorized" }))).toBe(false);
    expect(isStepUpRequired(new ApiError(403, "x", { error: "step_up_required" }))).toBe(false);
    expect(isStepUpRequired(new Error("step_up_required"))).toBe(false);
  });
});

describe("safeReturnPath", () => {
  it.each([
    ["/ramp", "/ramp"],
    ["/(tabs)", "/(tabs)"],
    ["//evil.example", "/(tabs)"],
    ["https://evil.example", "/(tabs)"],
    ["javascript:alert(1)", "/(tabs)"],
    [undefined, "/(tabs)"],
  ])("%j -> %j", (raw, expected) => expect(safeReturnPath(raw)).toBe(expected));
});

describe("parseOtp", () => {
  it("accepts digits only", () => {
    expect(parseOtp(" 123 456 ")).toBe("123456");
    expect(parseOtp("12ab56")).toBeNull();
    expect(parseOtp("12")).toBeNull();
  });
});

describe("step-up screen", () => {
  const src = fs
    .readFileSync(path.join(__dirname, "..", "..", "app", "step-up.tsx"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("uses a server-verified ceremony, with the account's own email only", () => {
    expect(src).toMatch(/signInWithPasskey/);
    expect(src).toMatch(/verifyOtp\(email,/);
    expect(src).toMatch(/api<\{ email\?: string \| null \}>\("\/profile"\)/);
    // The email is displayed, not typed: no editable address field.
    expect(src).not.toMatch(/label="Email"/);
  });

  it("does not offer a selfie check it cannot perform", () => {
    expect(src).not.toMatch(/selfie|liveness/i);
  });
});
