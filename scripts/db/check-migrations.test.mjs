// node --test scripts/db/check-migrations.test.mjs   (T-D1)
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkNames, immutabilityViolations } from "./check-migrations.mjs";

test("contiguous, well-named migrations pass", () => {
  assert.deepEqual(checkNames(["0001_init.sql", "0002_durability.sql", "README.md"]), []);
});

test("gap, duplicate and bad name are each reported", () => {
  assert.match(checkNames(["0001_a.sql", "0003_c.sql"]).join(), /gap/);
  assert.match(checkNames(["0001_a.sql", "0001_b.sql"]).join(), /duplicate/);
  assert.match(checkNames(["0001_a.sql", "2_bad.sql"]).join(), /bad migration file name/);
});

test("adding a migration is allowed; modifying or deleting one is not", () => {
  assert.deepEqual(immutabilityViolations("A\tsupabase/migrations/0025_x.sql\n"), []);
  assert.equal(immutabilityViolations("M\tsupabase/migrations/0022_webhook_events.sql").length, 1);
  assert.equal(immutabilityViolations("D\tsupabase/migrations/0005_linked_wallets.sql").length, 1);
});
