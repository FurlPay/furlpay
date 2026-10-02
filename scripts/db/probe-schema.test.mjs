import { test } from "node:test";
import assert from "node:assert/strict";
import { redactSecret } from "./probe-schema.mjs";

// Fake credentials only, deliberately not dictionary-like: redaction is
// fragment-based, so a password fragment that is also an English word is
// redacted wherever it appears (over-redaction, the safe failure). The probe's
// exit-2 message is what an operator pastes into a ticket or chat, so it must
// never contain the password.
const URL_OK = "postgresql://postgres.ref:Q7x%40zK9v:mP4t@aws-0-x.pooler.supabase.com:5432/postgres";

test("redacts the raw and the percent-decoded password", () => {
  const msg = "password authentication failed for Q7x%40zK9v:mP4t / Q7x@zK9v:mP4t";
  const out = redactSecret(msg, URL_OK);
  assert.ok(!out.includes("zK9v") && !out.includes("mP4t"), out);
  assert.ok(out.includes("[redacted]"));
});

test("redacts the fragment a mis-parsed (unencoded @) password leaks as a host", () => {
  const bad = "postgresql://postgres.ref:hunter2@Secret@aws-0-x.pooler.supabase.com:5432/postgres";
  const out = redactSecret("getaddrinfo ENOTFOUND Secret@aws-0-x.pooler.supabase.com", bad);
  assert.ok(!out.includes("Secret"), out);
  assert.ok(!out.includes("hunter2"), out);
});

test("leaves non-secret context (user, host) readable", () => {
  const out = redactSecret('password authentication failed for user "postgres.ref"', URL_OK);
  assert.equal(out, 'password authentication failed for user "postgres.ref"');
});

test("no DATABASE_URL: message passes through", () => {
  assert.equal(redactSecret("DATABASE_URL is required", ""), "DATABASE_URL is required");
});
