import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ sbSelect: vi.fn() }));
vi.mock("@/lib/push", () => ({ sendPushToUser: vi.fn(async () => 1) }));

import { heldPaymentPush, notifyApprovalHeld } from "../approvalNotify";
import { sbSelect } from "@/lib/supabase";
import { sendPushToUser } from "@/lib/push";

const notice = { organizationId: "org_1", approvalId: "cpap_1", amountAtomic: "1250500000", asset: "USDC" };

describe("heldPaymentPush", () => {
  it("carries the amount, a route and nothing a lock screen should not show", () => {
    const p = heldPaymentPush(notice);
    expect(p.body).toBe("An agent payment of 1250.50 USDC is on hold until you review it.");
    expect(p.url).toBe("/settlement/payouts/approvals");
    expect(p.tag).toBe("cpap_1");
    expect(p.data).toEqual({ kind: "control-plane-approval", approvalId: "cpap_1" });
  });

  it("does not re-scale an asset the control plane has no decimals for", () => {
    expect(heldPaymentPush({ ...notice, asset: "FOO", amountAtomic: "42" }).body).toContain("42 atomic units of FOO");
  });
});

describe("notifyApprovalHeld", () => {
  it("pushes to the organization owner", async () => {
    vi.mocked(sbSelect).mockResolvedValueOnce([{ owner_user_id: "user_1" }]);
    await notifyApprovalHeld(notice);
    expect(sendPushToUser).toHaveBeenCalledWith("user_1", expect.objectContaining({ tag: "cpap_1" }));
  });

  it("never throws: a lookup or push failure must not fail the authorization", async () => {
    vi.mocked(sbSelect).mockRejectedValueOnce(new Error("postgrest down"));
    await expect(notifyApprovalHeld(notice)).resolves.toBeUndefined();
    vi.mocked(sbSelect).mockResolvedValueOnce([{ owner_user_id: "user_1" }]);
    vi.mocked(sendPushToUser).mockRejectedValueOnce(new Error("fcm down"));
    await expect(notifyApprovalHeld(notice)).resolves.toBeUndefined();
  });

  it("sends nothing for an organization with no owner row", async () => {
    vi.mocked(sendPushToUser).mockClear();
    vi.mocked(sbSelect).mockResolvedValueOnce([]);
    await notifyApprovalHeld(notice);
    expect(sendPushToUser).not.toHaveBeenCalled();
  });
});
