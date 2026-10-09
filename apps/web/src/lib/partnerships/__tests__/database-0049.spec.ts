import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// 0049 on PGlite: storage, dedupe, constraints, compare-and-set status, purge guard.
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
  await db.exec(readFileSync(resolve(process.cwd(), "../../supabase/migrations/0049_partnership_inquiries.sql"), "utf8"));
}, 30000);
afterAll(async () => { await db?.close(); });

const row = (over: Record<string, unknown> = {}) => ({ company_name: "Acme Labs", work_email: "ops@acme.example", contact_method: "telegram", contact_detail: "@acme_ops", full_name: "", job_title: "", website: "https://acme.example/", partnership_interest: "card-issuing", additional_information: "hello", source_page: "partners_card", ...over });
const submit = async (over: Record<string, unknown> = {}) => (await db.query<{ id: string; duplicate: boolean }>("select * from partnership_inquiry_submit($1::jsonb)", [JSON.stringify(row(over))])).rows[0];

describe("partnership inquiries (0049)", () => {
  it("stores an inquiry as new, with empty optionals as null and notification pending", async () => {
    const r = await submit();
    expect(r.duplicate).toBe(false);
    const s = (await db.query<{ status: string; full_name: string | null; notification_state: string }>("select status, full_name, notification_state from partnership_inquiries where id=$1", [r.id])).rows[0];
    expect(s).toEqual({ status: "new", full_name: null, notification_state: "pending" });
  });
  it("same email + interest + day is one inquiry (case-insensitive email); another interest is new", async () => {
    const a = await submit({ partnership_interest: "wallet-custody" });
    const b = await submit({ partnership_interest: "wallet-custody", work_email: "OPS@acme.example" });
    expect(b).toEqual({ id: a.id, duplicate: true });
    expect((await submit({ partnership_interest: "travel-commerce" })).duplicate).toBe(false);
  });
  it("rejects values the form would never send", async () => {
    for (const bad of [{ contact_method: "fax" }, { partnership_interest: "lobbying" }, { website: "javascript:alert(1)" }, { company_name: "x" }, { work_email: "nope" }, { additional_information: "x".repeat(4001) }]) {
      await expect(submit({ partnership_interest: "developer-api", ...bad })).rejects.toThrow();
    }
  });
  it("status changes are compare-and-set and leave an activity record", async () => {
    const { id } = await submit({ partnership_interest: "strategic-business" });
    const set = (from: string, to: string) => db.query<{ r: boolean }>("select partnership_inquiry_set_status($1, $2, $3, $4, $5) r", [id, from, to, "admin@example.test", "called"]).then(x => x.rows[0].r);
    expect(await set("new", "reviewing")).toBe(true);
    expect(await set("new", "contacted")).toBe(false); // stale view: refused
    expect(await set("reviewing", "reviewing")).toBe(false); // no-op
    const act = (await db.query<{ kind: string; from_status: string; to_status: string; actor: string }>("select kind, from_status, to_status, actor from partnership_inquiry_activity where inquiry_id=$1", [id])).rows;
    expect(act).toEqual([{ kind: "status", from_status: "new", to_status: "reviewing", actor: "admin@example.test" }]);
  });
  it("purge refuses a recent cutoff and only deletes closed/declined", async () => {
    await expect(db.query("select partnership_inquiry_purge(now())")).rejects.toThrow(/purge_window_too_recent/);
    const { id } = await submit({ partnership_interest: "security-compliance" });
    await db.query("update partnership_inquiries set status = $2, updated_at = now() - interval '400 days' where id = $1", [id, "declined"]);
    const before = (await db.query<{ n: number }>("select count(*)::int n from partnership_inquiries")).rows[0].n;
    expect((await db.query<{ n: number }>("select partnership_inquiry_purge(now() - interval '365 days') n")).rows[0].n).toBe(1);
    expect((await db.query<{ n: number }>("select count(*)::int n from partnership_inquiries")).rows[0].n).toBe(before - 1);
  });
  it("public roles cannot access either table or any privileged RPC", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      try {
        for (const sql of ["select * from partnership_inquiries", "select * from partnership_inquiry_activity", "select * from partnership_inquiry_submit('{}')", "select partnership_inquiry_purge(now())", "select partnership_inquiry_set_status(null,'new','closed','x','')"]) {
          await expect(db.query(sql)).rejects.toThrow(/permission denied/);
        }
      } finally { await db.exec("reset role"); }
    }
  });
  it("service role can submit, add a note and read its activity under RLS", async () => {
    await db.exec("set role service_role");
    try {
      const { id } = await submit({ work_email: "service@acme.example" });
      await db.query("insert into partnership_inquiry_activity(inquiry_id,kind,note,actor) values ($1,'note','Follow up','admin')", [id]);
      expect((await db.query("select * from partnership_inquiry_activity where inquiry_id=$1", [id])).rows).toHaveLength(1);
    } finally { await db.exec("reset role"); }
  });
});
