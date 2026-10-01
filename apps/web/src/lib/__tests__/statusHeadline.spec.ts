import { describe, expect, it } from "vitest";
import { headline } from "../statusHeadline";

// /status used to hardcode "All systems operational". It is now derived.
describe("status headline", () => {
  it("never claims operational without a fresh HEALTHY signal on every configured rail", () => {
    expect(headline(null).text).toBe("Status currently unavailable");
    expect(headline([]).text).toBe("Status partially unknown");
    expect(headline(["UNKNOWN", "UNKNOWN"]).text).toBe("Status partially unknown");
    expect(headline(["NOT_CONFIGURED", "NOT_CONFIGURED"]).text).toBe("Status partially unknown");
    expect(headline(["HEALTHY", "UNKNOWN"]).text).toBe("Status partially unknown");
    expect(headline(["HEALTHY", "NOT_CONFIGURED"]).text).toBe("All monitored rails operational");
  });
  it("surfaces trouble", () => {
    expect(headline(["HEALTHY", "INCIDENT"]).text).toBe("Service disruption");
    expect(headline(["HEALTHY", "PAUSED"]).text).toBe("Some services degraded");
    expect(headline(["DEGRADED"]).text).toBe("Some services degraded");
  });
});
