import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest, NextResponse } from "next/server";
const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  limit: vi.fn(),
  list: vi.fn(),
  save: vi.fn(),
  archive: vi.fn(),
}));
vi.mock("@/lib/authz", () => ({ requireUser: mocks.auth }));
vi.mock("@/lib/rateLimit", () => ({ rateLimitOr429: mocks.limit }));
vi.mock("@/lib/settlement/repository", () => ({
  listRecords: mocks.list,
  saveRecord: mocks.save,
  archiveRecord: mocks.archive,
  RecordConflict: class extends Error {},
}));
import { GET, PATCH, POST } from "../route";
const owner = "test-owner";
const address = "0x1111111111111111111111111111111111111111";
const payload = {
  id: "a0000000-0000-4000-8000-000000000001",
  data: {
    kind: "payout",
    name: "Recipient",
    address,
    network: "arbitrum",
    asset: "USDC",
    amount: "10.25",
    note: "Invoice",
  },
};
function req(body?: unknown, method = "POST") {
  return new NextRequest("https://furlpay.com/api/settlement/workspace", {
    method,
    ...(body !== undefined
      ? {
          body: JSON.stringify(body),
          headers: { "content-type": "application/json" },
        }
      : {}),
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({
    ok: true,
    account: {
      user: {
        id: owner,
        name: "Workspace",
        kycStatus: "pending",
        security: { totpSecret: "never-return" },
        email: "private@example.test",
      },
      tokenBalances: [],
      fiatBalances: [],
      transactions: [],
    },
  });
  mocks.limit.mockResolvedValue(null);
  mocks.list.mockResolvedValue([]);
  mocks.save.mockResolvedValue({
    id: payload.id,
    data: payload.data,
    createdAt: "2026-10-08T00:00:00Z",
    archivedAt: null,
  });
  mocks.archive.mockResolvedValue(true);
});
describe("settlement API", () => {
  it("requires authentication for reading and mutations", async () => {
    mocks.auth.mockResolvedValue({
      ok: false,
      res: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    expect((await GET(req(undefined, "GET"))).status).toBe(401);
    expect((await POST(req(payload))).status).toBe(401);
    expect((await PATCH(req({ id: payload.id }, "PATCH"))).status).toBe(401);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("returns a whitelisted snapshot without private user or bank data", async () => {
    const response = await GET(req(undefined, "GET"));
    const body = await response.text();
    expect(body).not.toContain("never-return");
    expect(body).not.toContain("private@example.test");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(mocks.list).toHaveBeenCalledWith(owner);
  });
  it("validates the body and refuses mass assignment before persistence", async () => {
    expect((await POST(req({ ...payload, owner_id: "victim" }))).status).toBe(
      400
    );
    expect(
      (await POST(req({ ...payload, data: { ...payload.data, amount: "-1" } })))
        .status
    ).toBe(400);
    expect(
      (
        await POST(
          req({ ...payload, data: { ...payload.data, status: "settled" } })
        )
      ).status
    ).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("validates Solana addresses with PublicKey before saving", async () => {
    expect(
      (
        await POST(
          req({
            ...payload,
            data: { ...payload.data, network: "solana", address },
          })
        )
      ).status
    ).toBe(400);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("persists only a draft for the authenticated owner", async () => {
    const response = await POST(req(payload));
    expect(response.status).toBe(201);
    expect(mocks.save).toHaveBeenCalledWith(owner, payload.id, payload.data);
    expect(await response.json()).not.toHaveProperty("transactionHash");
  });
  it("enforces rate limits and the body cap", async () => {
    mocks.limit.mockResolvedValueOnce(
      NextResponse.json({ error: "Rate limited" }, { status: 429 })
    );
    expect((await POST(req(payload))).status).toBe(429);
    expect((await POST(req({ padding: "x".repeat(102401) }))).status).toBe(413);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("reports storage outages without manufacturing a saved record", async () => {
    mocks.save.mockRejectedValue(new Error("db failure"));
    mocks.list.mockRejectedValue(new Error("db failure"));
    expect((await POST(req(payload))).status).toBe(503);
    const read = await GET(req(undefined, "GET"));
    expect((await read.json()).storage).toBe("unavailable");
  });
});
