import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabaseBackend: "supabase",
  sbSelect: mocks.select,
  sbInsertIgnoreDuplicates: mocks.insert,
  sbUpdate: mocks.update,
}));
import {
  archiveRecord,
  listRecords,
  RecordConflict,
  saveRecord,
} from "../repository";

const payload = {
  kind: "rule" as const,
  name: "Split",
  network: "arbitrum" as const,
  allocations: [
    { label: "Treasury", percentage: 80 },
    { label: "Reserve", percentage: 20 },
  ],
};
const row = {
  owner_id: "owner-A",
  id: "a0000000-0000-4000-8000-000000000001",
  payload,
  created_at: "2026-10-08T00:00:00Z",
  archived_at: null,
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.select.mockResolvedValue([row]);
  mocks.insert.mockResolvedValue(undefined);
  mocks.update.mockResolvedValue([row]);
});
describe("durable workspace records", () => {
  it("scopes every read and update to the authenticated owner", async () => {
    await listRecords("owner-A");
    await archiveRecord("owner-A", row.id);
    expect(mocks.select.mock.calls[0][1]).toContain("owner_id=eq.owner-A");
    expect(mocks.update.mock.calls[0][1]).toBe(
      `owner_id=eq.owner-A&id=eq.${row.id}`
    );
  });
  it("replays an existing identical draft without overwriting it", async () => {
    const saved = await saveRecord("owner-A", row.id, payload);
    expect(saved.createdAt).toBe(row.created_at);
    expect(saved).not.toHaveProperty("owner_id");
    expect(mocks.insert.mock.calls[0][1]).toMatchObject({
      id: row.id,
      owner_id: "owner-A",
      payload,
    });
    expect(mocks.update).not.toHaveBeenCalled();
  });
  it("rejects a request ID replay with changed financial instructions", async () => {
    await expect(
      saveRecord("owner-A", row.id, { ...payload, name: "Different rule" })
    ).rejects.toBeInstanceOf(RecordConflict);
  });
  it("never reports an archive of another account's missing record as success", async () => {
    mocks.update.mockResolvedValue([]);
    expect(await archiveRecord("owner-B", row.id)).toBe(false);
  });
});
