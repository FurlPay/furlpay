import * as WebBrowser from "expo-web-browser";
import * as kyc from "../kyc";
import { runVerificationFlow, startVerification, fetchKycStatus } from "../kyc";
import { api } from "../api";

jest.mock("expo-web-browser", () => ({
  openAuthSessionAsync: jest.fn(),
  openBrowserAsync: jest.fn(),
}));
jest.mock("../api", () => ({ api: jest.fn() }));

const mockApi = api as jest.MockedFunction<typeof api>;
const mockAuthSession = WebBrowser.openAuthSessionAsync as jest.MockedFunction<
  typeof WebBrowser.openAuthSessionAsync
>;

const SESSION = {
  sessionId: "inq_123",
  sessionUrl: "https://verify.example.com/inquiry/abc",
  requiredDocs: ["government_id"],
  requiredChecks: ["selfie", "liveness"],
  eddRequired: false,
};

beforeEach(() => jest.clearAllMocks());

describe("startVerification", () => {
  it("normalizes the country to ISO alpha-2, which the server's schema requires", async () => {
    mockApi.mockResolvedValue(SESSION);
    await startVerification("  gb  ");
    expect(mockApi).toHaveBeenCalledWith("/compliance/verify", {
      method: "POST",
      body: { country: "GB" },
    });
  });

  it("omits referenceId rather than sending undefined", async () => {
    mockApi.mockResolvedValue(SESSION);
    await startVerification("US");
    expect(mockApi.mock.calls[0][1]?.body).toEqual({ country: "US" });
  });

  it("passes a referenceId through when supplied", async () => {
    mockApi.mockResolvedValue(SESSION);
    await startVerification("US", "ref-1");
    expect(mockApi.mock.calls[0][1]?.body).toEqual({ country: "US", referenceId: "ref-1" });
  });
});

describe("runVerificationFlow", () => {
  it("uses the system browser auth session, never a WebView", async () => {
    mockAuthSession.mockResolvedValue({ type: "success", url: "furlpay://verify-identity" } as never);
    await runVerificationFlow(SESSION, "furlpay://verify-identity");
    // An in-app WebView would let this process read the provider's cookies and
    // inject script into a passport-capture screen.
    expect(mockAuthSession).toHaveBeenCalledWith(SESSION.sessionUrl, "furlpay://verify-identity");
  });

  it("reports SUBMITTED — never approved — when the provider redirects back", async () => {
    mockAuthSession.mockResolvedValue({ type: "success", url: "x" } as never);
    const out = await runVerificationFlow(SESSION, "furlpay://verify-identity");
    // The critical assertion. A closed browser proves the user reached the end
    // of the flow, not that they passed it: the provider tells the SERVER over
    // a signed webhook. Treating this as an approval would let anyone grant
    // themselves a verified tier by dismissing a screen.
    expect(out).toEqual({ status: "submitted", sessionId: "inq_123" });
    expect(JSON.stringify(out)).not.toContain("approved");
  });

  it("reports dismissed when the user closes the tab", async () => {
    mockAuthSession.mockResolvedValue({ type: "dismiss" } as never);
    const out = await runVerificationFlow(SESSION, "furlpay://verify-identity");
    expect(out).toEqual({ status: "dismissed", sessionId: "inq_123" });
  });

  it("treats a cancel as dismissed, not as an error", async () => {
    mockAuthSession.mockResolvedValue({ type: "cancel" } as never);
    const out = await runVerificationFlow(SESSION, "furlpay://verify-identity");
    expect(out.status).toBe("dismissed");
  });

  it("surfaces a browser failure as unavailable instead of throwing", async () => {
    mockAuthSession.mockRejectedValue(new Error("no browser"));
    const out = await runVerificationFlow(SESSION, "furlpay://verify-identity");
    expect(out).toEqual({ status: "unavailable", reason: "no browser" });
  });
});

describe("fetchKycStatus", () => {
  it("reads status, tier and region from the SERVER's account record", async () => {
    mockApi.mockResolvedValue({
      user: { kycStatus: "approved", tier: "Pro", region: "GB" },
    } as never);
    await expect(fetchKycStatus()).resolves.toEqual({
      kycStatus: "approved",
      tier: "Pro",
      region: "GB",
    });
    expect(mockApi).toHaveBeenCalledWith("/overview");
  });
});

describe("the module never handles biometric material", () => {
  it("exposes no upload/capture surface", () => {
    // A guard against the obvious "improvement" — adding a camera screen that
    // POSTs a passport to our API. Documents and selfies must reach the
    // provider directly; the moment they touch this process they are in scope
    // for every biometric-data regime that applies to the user.
    for (const name of Object.keys(kyc)) {
      expect(name).not.toMatch(/upload|capture|selfie|document|photo|image/i);
    }
  });
});
