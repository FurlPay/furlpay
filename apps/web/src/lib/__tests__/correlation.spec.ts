import { describe, it, expect } from "vitest";
import { ensureCorrelationId } from "@/lib/correlation";

describe("ensureCorrelationId", () => {
  it("passes through a well-formed client id", () => {
    expect(ensureCorrelationId("abc-123_XYZ.45")).toBe("abc-123_XYZ.45");
  });
  it("mints a uuid when absent", () => {
    expect(ensureCorrelationId(null)).toMatch(/^[0-9a-f-]{36}$/);
    expect(ensureCorrelationId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
    expect(ensureCorrelationId("")).toMatch(/^[0-9a-f-]{36}$/);
  });
  it("rejects junk / too-short / too-long / newline (log-injection defense)", () => {
    expect(ensureCorrelationId("short")).toMatch(/^[0-9a-f-]{36}$/); // <8
    expect(ensureCorrelationId("x".repeat(65))).toMatch(/^[0-9a-f-]{36}$/); // >64
    expect(ensureCorrelationId("has space")).toMatch(/^[0-9a-f-]{36}$/);
    expect(ensureCorrelationId("line\nbreak000")).toMatch(/^[0-9a-f-]{36}$/);
  });
});
