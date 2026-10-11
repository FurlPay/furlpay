// Test-only onboarding fixtures. Imported by specs; never by application code.
// Names and numbers are fictional (example.test domain, Ofcom drama-range phone).

export const business = { type: "company", legalName: "Northwind Analytics Ltd", country: "GB", registrationNumber: "12345678", industry: "Technology & Software", address: { line1: "1 Example Street", city: "London", region: "Greater London", postalCode: "EC1A 1BB" } };
export const identity = { verification: "kyb", representative: { fullName: "Avery Quinn", dateOfBirth: "1988-10-15", email: "avery@example.test", phoneCountry: "GB", phone: "20 7946 0018", idType: "PASSPORT", idNumberLast4: "4567" } };
export const details = { incorporationDate: "2019-03-01", description: "Analytics software.", employees: "11 - 50", revenue: "$1M - $10M", owners: [{ id: "00000000-0000-4000-8000-000000000001", name: "Avery Quinn", type: "individual", percent: 70, role: "CEO" }] };
export const treasury = { networks: ["arbitrum", "base"], assets: ["USDC"], destination: "split" };
const rid = (n: number) => `00000000-0000-4000-8000-00000000010${n}`;
export const settlement = (percents: number[]) => ({
  model: "split",
  rules: percents.map((p, i) => ({ id: rid(i), percent: p, destination: (["treasury", "vendor", "reserve"] as const)[i], label: "x", assets: "all" })),
  routing: [
    { network: "arbitrum", enabled: true, primary: true },
    { network: "base", enabled: true, primary: false },
  ],
  preferences: { autoConversion: false, networkOptimization: true, complianceChecks: true },
  notifications: { paymentReceived: true, payoutSent: true, approvalRequired: true, dailySummary: false },
  advanced: { manualReviewAboveUsd: 0, minimumSettlementUsd: 0 },
});
export const REQUIRED_DOCS = ["incorporation", "articles", "address", "id_front"] as const;
