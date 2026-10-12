import { routeFor } from "../push";

// A tapped notification only navigates. These pin where each kind lands.
describe("push routing", () => {
  it("sends a 3-D Secure challenge to card approvals", () => {
    expect(routeFor({ kind: "card-auth-challenge", url: "/cards/approve?challenge=c1" })).toBe("/approvals");
  });

  it("sends a held agent payment to the held-payments screen, not the web url", () => {
    expect(routeFor({ kind: "control-plane-approval", approvalId: "cpap_1", url: "/settlement/payouts/approvals" })).toBe(
      "/held-payments"
    );
  });
});
