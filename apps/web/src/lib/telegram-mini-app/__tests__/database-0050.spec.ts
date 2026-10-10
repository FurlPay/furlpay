import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { citext } from "@electric-sql/pglite/contrib/citext";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { TELEGRAM_USER_ID_MAX } from "../verify";

let db: PGlite;
const owner = "00000000-0000-4000-8000-000000000001";
const other = "00000000-0000-4000-8000-000000000002";
beforeAll(async () => {
  db = new PGlite({ extensions: { citext } });
  await db.exec("create role anon; create role authenticated; create role service_role bypassrls;");
  for (const file of ["0001_init.sql", "0050_telegram_account_links.sql"]) {
    await db.exec(readFileSync(resolve(process.cwd(), "../../supabase/migrations", file), "utf8"));
  }
  await db.query("insert into users (id, name, email, safe_address) values ($1, 'Synthetic', 'one@example.test', 'fixture'), ($2, 'Synthetic', 'two@example.test', 'fixture')", [owner, other]);
}, 30_000);
afterAll(async () => { await db?.close(); });

describe("Telegram identity storage (actual 0050 migration)", () => {
  it("has RLS, a user FK, unique owners and indexes on both lookup keys", async () => {
    expect((await db.query<{ enabled: boolean }>("select relrowsecurity enabled from pg_class where oid='telegram_account_links'::regclass")).rows[0].enabled).toBe(true);
    const indexes = (await db.query<{ indexdef: string }>("select indexdef from pg_indexes where tablename='telegram_account_links'")).rows.map(r => r.indexdef).join(" ");
    expect(indexes).toContain("UNIQUE"); expect(indexes).toContain("(telegram_id)"); expect(indexes).toContain("(user_id)");
  });
  it("denies anonymous and authenticated access, including reads and writes", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.exec(`set role ${role}`);
      try {
        for (const query of ["select * from telegram_account_links", "delete from telegram_account_links", `insert into telegram_account_links (telegram_id,user_id) values (111,'${owner}')`]) {
          await expect(db.query(query)).rejects.toThrow(/permission denied/);
        }
      } finally { await db.exec("reset role"); }
    }
  });
  it("allows the server role to link and read, but refuses duplicate identities and owners", async () => {
    await db.exec("set role service_role");
    try {
      await db.query("insert into telegram_account_links (telegram_id,user_id) values (111,$1)", [owner]);
      expect((await db.query("select telegram_id from telegram_account_links")).rows).toHaveLength(1);
      await expect(db.query("insert into telegram_account_links (telegram_id,user_id) values (111,$1)", [other])).rejects.toThrow(/unique/);
      await expect(db.query("insert into telegram_account_links (telegram_id,user_id) values (222,$1)", [owner])).rejects.toThrow(/unique/);
    } finally { await db.exec("reset role"); }
  });
  it("rejects orphan users and out-of-contract Telegram IDs", async () => {
    await expect(db.query("insert into telegram_account_links values (333,'00000000-0000-4000-8000-000000000003')")).rejects.toThrow(/foreign key/);
    for (const id of [0, -1, TELEGRAM_USER_ID_MAX + 1]) await expect(db.query("insert into telegram_account_links (telegram_id,user_id) values ($1,$2)", [id, other])).rejects.toThrow(/check constraint/);
    await db.query("insert into telegram_account_links (telegram_id,user_id) values ($1,$2)", [TELEGRAM_USER_ID_MAX, other]);
  });
  it("removes only the deleted account's link through the foreign key", async () => {
    await db.query("delete from users where id=$1", [owner]);
    expect((await db.query<{ user_id: string }>("select user_id from telegram_account_links")).rows).toEqual([{ user_id: other }]);
  });
});
