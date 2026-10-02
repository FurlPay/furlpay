import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isStepUpCode, isStepUpRequired, maskEmail } from "../stepUp";

describe("extension step-up helpers", () => {
  it("masks the email it shows", () => {
    expect(maskEmail("priya.sharma@example.com")).toBe("p•••a@example.com");
    expect(maskEmail("ab@x.io")).toBe("a•••@x.io");
    expect(maskEmail("nonsense")).toBe("your email");
  });

  it("accepts numeric codes only", () => {
    expect(isStepUpCode("123456")).toBe(true);
    expect(isStepUpCode("12a456")).toBe(false);
    expect(isStepUpCode(123456)).toBe(false);
  });

  it("recognises the server's step-up refusal", () => {
    expect(isStepUpRequired("step_up_required")).toBe(true);
    expect(isStepUpRequired("HTTP 401")).toBe(false);
  });
});

describe("background step-up handlers", () => {
  const bg = readFileSync(join(__dirname, "..", "..", "entrypoints", "background.ts"), "utf8");
  const block = bg.slice(bg.indexOf('case "STEP_UP_SEND"'), bg.indexOf('case "GET_EARN"'));

  it("read the address from the account, never from the popup message", () => {
    expect(block).toMatch(/apiFetch<\{ email\?: string \| null \}>\("\/api\/profile"\)/);
    expect(block).toMatch(/to: p\.email/);
    expect(block).not.toMatch(/message\.email|message\.to/);
  });
});
