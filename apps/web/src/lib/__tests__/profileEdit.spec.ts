// Display-name editing via PATCH /api/profile. Drives the REAL route handler.

import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { PATCH as profilePATCH, GET as profileGET } from "@/app/api/profile/route";
import { signSession } from "@/lib/session";
import { findOrCreateUserByIdentity } from "@/lib/store";
import { auditEntries } from "@/lib/audit";

async function actor() {
  const email = `edit-${randomUUID()}@furlpay.test`;
  const { account } = findOrCreateUserByIdentity({ email, name: "Original Name" });
  const token = await signSession({ sub: account.user.id, safe: "0x0", roles: ["user"], jti: randomUUID() });
  return { userId: account.user.id, token };
}

function patchReq(token: string | undefined, body: unknown) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-forwarded-for": `10.9.0.${Math.floor(Math.random() * 250)}`,
  };
  if (token) headers.authorization = `Bearer ${token}`;
  return new NextRequest("https://furlpay.com/api/profile", {
    method: "PATCH",
    headers,
    body: JSON.stringify(body),
  });
}

describe("PATCH /api/profile — display name", () => {
  it("updates the name and returns the new value", async () => {
    const a = await actor();
    const res = await profilePATCH(patchReq(a.token, { name: "Ada Lovelace" }));
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe("Ada Lovelace");

    // Reflected on a subsequent GET.
    const get = await profileGET(patchReq(a.token, {}));
    expect((await get.json()).name).toBe("Ada Lovelace");
  });

  it("trims surrounding whitespace", async () => {
    const a = await actor();
    const res = await profilePATCH(patchReq(a.token, { name: "  Grace Hopper  " }));
    expect((await res.json()).name).toBe("Grace Hopper");
  });

  it("accepts names with spaces and unicode", async () => {
    const a = await actor();
    const res = await profilePATCH(patchReq(a.token, { name: "José Álvarez" }));
    expect(res.status).toBe(200);
    expect((await res.json()).name).toBe("José Álvarez");
  });

  it("rejects an empty name", async () => {
    const a = await actor();
    expect((await profilePATCH(patchReq(a.token, { name: "   " }))).status).toBe(400);
  });

  it("rejects an over-long name (>50)", async () => {
    const a = await actor();
    expect((await profilePATCH(patchReq(a.token, { name: "x".repeat(51) }))).status).toBe(400);
  });

  it("rejects control characters", async () => {
    const a = await actor();
    expect((await profilePATCH(patchReq(a.token, { name: "badname" }))).status).toBe(400);
  });

  it("401s an unauthenticated request", async () => {
    expect((await profilePATCH(patchReq(undefined, { name: "x" }))).status).toBe(401);
  });

  it("writes a profile.updated audit event carrying no PII", async () => {
    const a = await actor();
    await profilePATCH(patchReq(a.token, { name: "Katherine Johnson" }));
    const entry = auditEntries(500).find((e) => e.event === "profile.updated" && e.actor === a.userId);
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry!.fields)).not.toContain("Katherine");
    expect(entry!.fields.field).toBe("name");
  });
});
