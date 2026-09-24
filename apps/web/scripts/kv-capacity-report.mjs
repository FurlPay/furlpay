#!/usr/bin/env node
// ---------------------------------------------------------------------------
// What is actually filling the KV database?
//
// Written for the `ERR DB capacity quota exceeded` incident at 268435456 bytes
// (256 MB). "Buy more capacity" is not a diagnosis — a key family with no TTL
// refills any ceiling you give it, just more slowly.
//
// STRICTLY READ-ONLY. It issues DBSIZE, SCAN, MEMORY USAGE, TTL and TYPE, and
// nothing else. It never writes, never deletes, and NEVER PRINTS A VALUE —
// these keys hold session material, push tokens, support messages and avatar
// bytes, so only key SHAPES and SIZES are reported. Key ids are collapsed to
// `{id}` before aggregation so nothing user-identifying reaches the output.
//
//   node apps/web/scripts/kv-capacity-report.mjs          # reads .env.local
//   KV_SCAN_LIMIT=200000 node apps/web/scripts/kv-capacity-report.mjs
//
// SCAN is incremental and safe against a live database. MEMORY USAGE is O(1)
// per key with sampling, but it is one round trip per key over the REST API, so
// the report samples rather than measuring every key once the DB is large.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

function loadEnvLocal() {
  // Repo root is three levels up from apps/web/scripts.
  for (const p of [resolve(here, "../.env.local"), resolve(here, "../../../.env.local")]) {
    try {
      for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
        const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
        if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
      }
    } catch {
      /* not there — fall through to the shell environment */
    }
  }
}
loadEnvLocal();

const URL_ = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
const TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;

if (!URL_ || !TOKEN) {
  console.error(
    "No KV credentials. Set UPSTASH_REDIS_REST_URL/TOKEN or KV_REST_API_URL/TOKEN,\n" +
      "or run from a checkout with .env.local present."
  );
  process.exit(1);
}

/** One Upstash REST command. Read-only commands only — see the header. */
const READ_ONLY = new Set(["DBSIZE", "SCAN", "MEMORY", "TTL", "TYPE", "LLEN", "STRLEN", "INFO"]);

async function cmd(args) {
  const verb = String(args[0]).toUpperCase();
  if (!READ_ONLY.has(verb)) throw new Error(`refusing non-read-only command: ${verb}`);
  const res = await fetch(URL_, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
  if (!res.ok) throw new Error(`${verb} failed: ${res.status} ${await res.text()}`);
  const body = await res.json();
  if (body.error) throw new Error(`${verb}: ${body.error}`);
  return body.result;
}

/**
 * Collapse a key to its FAMILY.
 *
 * `profile:avatar:usr_01H9…` -> `profile:avatar:{id}`
 *
 * Aggregating by family is the whole point: 3,000 keys that each look unique
 * are one design decision, and it is the decision that has to change. It also
 * means no user identifier is printed.
 */
function family(key) {
  return key
    .split(":")
    .map((seg) =>
      /^[0-9a-fA-F-]{8,}$/.test(seg) || /^[A-Za-z0-9_-]{16,}$/.test(seg) || /^\d+$/.test(seg) || seg.includes("@")
        ? "{id}"
        : seg
    )
    .join(":");
}

const SCAN_LIMIT = Number(process.env.KV_SCAN_LIMIT || 50_000);
const SAMPLE_PER_FAMILY = Number(process.env.KV_SAMPLE_PER_FAMILY || 25);

const bytes = (n) =>
  n > 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : n > 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} B`;

async function main() {
  const dbsize = await cmd(["DBSIZE"]);
  console.log(`\nDBSIZE: ${dbsize} keys\n`);

  // --- pass 1: enumerate key families -------------------------------------
  const families = new Map(); // family -> { count, samples[] }
  let cursor = "0";
  let scanned = 0;
  do {
    const [next, keys] = await cmd(["SCAN", cursor, "COUNT", 1000]);
    cursor = next;
    for (const k of keys) {
      const f = family(k);
      let e = families.get(f);
      if (!e) families.set(f, (e = { count: 0, samples: [] }));
      e.count++;
      if (e.samples.length < SAMPLE_PER_FAMILY) e.samples.push(k);
    }
    scanned += keys.length;
    if (scanned >= SCAN_LIMIT) {
      console.log(`(stopped at KV_SCAN_LIMIT=${SCAN_LIMIT}; raise it for a full pass)\n`);
      break;
    }
  } while (cursor !== "0");

  // --- pass 2: sample sizes + TTL per family -------------------------------
  const rows = [];
  for (const [f, { count, samples }] of families) {
    let sampledBytes = 0;
    let withTtl = 0;
    let measured = 0;
    for (const k of samples) {
      try {
        const used = await cmd(["MEMORY", "USAGE", k]);
        if (typeof used === "number") {
          sampledBytes += used;
          measured++;
        }
        const ttl = await cmd(["TTL", k]);
        // -1 = key exists with NO expiry. -2 = gone. >=0 = seconds remaining.
        if (typeof ttl === "number" && ttl >= 0) withTtl++;
      } catch {
        /* key expired mid-scan — expected on a live DB */
      }
    }
    const avg = measured ? sampledBytes / measured : 0;
    rows.push({
      family: f,
      count,
      avg,
      projected: avg * count,
      ttlPct: samples.length ? Math.round((withTtl / samples.length) * 100) : 0,
    });
  }

  rows.sort((a, b) => b.projected - a.projected);

  const total = rows.reduce((s, r) => s + r.projected, 0);

  console.log("Projected footprint = average sampled size x key count.\n");
  console.log(
    "PROJECTED".padStart(11) +
      "  " +
      "KEYS".padStart(8) +
      "  " +
      "AVG".padStart(9) +
      "  " +
      "TTL".padStart(5) +
      "  FAMILY"
  );
  console.log("-".repeat(78));
  for (const r of rows.slice(0, 30)) {
    console.log(
      bytes(r.projected).padStart(11) +
        "  " +
        String(r.count).padStart(8) +
        "  " +
        bytes(r.avg).padStart(9) +
        "  " +
        `${r.ttlPct}%`.padStart(5) +
        "  " +
        r.family
    );
  }

  console.log("-".repeat(78));
  console.log(`${bytes(total).padStart(11)}  ${String(dbsize).padStart(8)}  projected total\n`);

  // --- the actual finding --------------------------------------------------
  // A family with 0% TTL is not "using space", it is ACCUMULATING space. It has
  // no steady state, so whatever ceiling the database has is reached eventually.
  const permanent = rows.filter((r) => r.ttlPct === 0 && r.count > 1);
  if (permanent.length) {
    console.log("KEY FAMILIES WITH NO EXPIRY — these grow without bound:\n");
    for (const r of permanent.slice(0, 15)) {
      console.log(`  ${bytes(r.projected).padStart(10)}  ${String(r.count).padStart(7)} keys  ${r.family}`);
    }
    const permTotal = permanent.reduce((s, r) => s + r.projected, 0);
    console.log(
      `\n  ${bytes(permTotal)} of ${bytes(total)} (${Math.round((permTotal / total) * 100)}%) is in keys that never expire.\n`
    );
  } else {
    console.log("Every sampled family carries a TTL.\n");
  }
}

main().catch((e) => {
  console.error(`\n${e.message}\n`);
  process.exit(1);
});
