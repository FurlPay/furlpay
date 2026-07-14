// Supabase-SPECIFIC validation for migration 0005 (PostgREST/RPC transport +
// service-role/anon permissions) — the layer the ephemeral-Postgres harness
// can't exercise. Zero deps (fetch only), mirrors apps/web/src/lib/supabase.ts.
//
// Runs against a real NON-PRODUCTION Supabase. Refuses production. Requires the
// migration (0001 + 0005) already applied.
//
//   SUPABASE_ENV=staging \
//   SUPABASE_URL=https://<ref>.supabase.co \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   SUPABASE_ANON_KEY=...  (optional, enables the deny tests) \
//   node scripts/db/supabase-validate.mjs
//
// Prints only the host (never keys). Cleans up its test rows.

import { randomUUID } from "node:crypto";

const BASE = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = process.env.SUPABASE_ANON_KEY;
const ENV = (process.env.SUPABASE_ENV || "").toLowerCase();

if (!BASE || !SERVICE) { console.error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required."); process.exit(2); }
if (ENV === "production" || ENV === "prod") { console.error("Refusing to run against production."); process.exit(2); }
if (ENV !== "staging" && ENV !== "local" && ENV !== "test") {
  console.error("Set SUPABASE_ENV=staging|local|test to confirm this is NON-PRODUCTION. Aborting."); process.exit(2);
}

const host = new URL(BASE).host;
console.log(`target: ${host}  (SUPABASE_ENV=${ENV}) — confirm NON-PRODUCTION`);

let failures = 0;
const ok = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}  ${m}`); if (!c) failures++; };

async function rest(method, path, body, key = SERVICE, prefer) {
  const res = await fetch(`${BASE}/rest/v1/${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(prefer ? { Prefer: prefer } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = text ? JSON.parse(text) : null; } catch { json = text; }
  return { status: res.status, json };
}
const rpc = (fn, args, key = SERVICE) => rest("POST", `rpc/${fn}`, args, key);

const A = "0x" + "a".repeat(40);
const uA = randomUUID(), uB = randomUUID();
const mkUser = (id) => ({ id, name: "pgtest", email: `pgtest_${id}@example.invalid`, safe_address: "0x" + id.replace(/-/g, "").slice(0, 40) });

async function main() {
  // Seed two users through the service role (proves service-role write works).
  const seed = await rest("POST", "users", [mkUser(uA), mkUser(uB)], SERVICE, "return=minimal");
  ok(seed.status === 201 || seed.status === 200, `service-role can seed users (status ${seed.status})`);

  // link_wallet via the real Supabase RPC client.
  const r1 = await rpc("link_wallet", { p_user_id: uA, p_address_norm: A.toLowerCase(), p_address: A, p_nonce: "0x1" });
  ok(r1.status === 200 && r1.json === "linked", `link_wallet() via RPC -> linked (got ${JSON.stringify(r1.json)})`);

  // Cross-account conflict: user B claims the same wallet.
  const r2 = await rpc("link_wallet", { p_user_id: uB, p_address_norm: A.toLowerCase(), p_address: A, p_nonce: "0x2" });
  ok(r2.json === "conflict_address", `cross-account same wallet -> conflict_address (got ${JSON.stringify(r2.json)})`);

  // Idempotent re-link by the same user.
  const r3 = await rpc("link_wallet", { p_user_id: uA, p_address_norm: A.toLowerCase(), p_address: A, p_nonce: "0x3" });
  ok(r3.json === "idempotent", `same user same wallet -> idempotent (got ${JSON.stringify(r3.json)})`);

  // CHECK constraint surfaced through the RPC (zero address must error).
  const rz = await rpc("link_wallet", { p_user_id: uA, p_address_norm: "0x" + "0".repeat(40), p_address: "0x" + "0".repeat(40), p_nonce: "0x4" });
  ok(rz.status >= 400, `zero address rejected through RPC (status ${rz.status})`);

  // Cold-instance hydration via get_linked_wallet RPC.
  const rh = await rpc("get_linked_wallet", { p_user_id: uA });
  ok(rh.status === 200 && Array.isArray(rh.json) && rh.json[0]?.address_norm === A.toLowerCase(), "get_linked_wallet() hydrates via RPC");

  // Negative: anon key must NOT execute privileged RPCs or read the table.
  if (ANON) {
    const an = await rpc("link_wallet", { p_user_id: uA, p_address_norm: A.toLowerCase(), p_address: A, p_nonce: "0x5" }, ANON);
    ok(an.status === 401 || an.status === 403 || an.status === 404, `anon CANNOT execute link_wallet (status ${an.status})`);
    const rd = await rest("GET", "linked_wallets?select=address_norm", undefined, ANON);
    ok(rd.status === 401 || (Array.isArray(rd.json) && rd.json.length === 0), `anon reads nothing from linked_wallets (status ${rd.status})`);
  } else {
    console.log("SKIP  anon-deny tests (SUPABASE_ANON_KEY not provided)");
  }

  // Cleanup.
  await rest("DELETE", `linked_wallets?user_id=in.(${uA},${uB})`, undefined, SERVICE);
  await rest("DELETE", `users?id=in.(${uA},${uB})`, undefined, SERVICE);
  console.log(failures === 0 ? "\nALL SUPABASE CHECKS PASSED" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
