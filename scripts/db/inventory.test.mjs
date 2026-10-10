import { test } from 'node:test';
import assert from 'node:assert/strict';
import { statements, withoutLeadingComments, sqlCode, inventory, generatedFiles } from './inventory.mjs';
import { reconcile, validateStagingUrl } from './probe-inventory.mjs';

test('SQL scanner preserves quoted semicolons, comments and dollar bodies', () => {
  const sql = "-- ignore ;\ncreate table x (value text default 'a;--b');\n/* outer /* nested; */ */ do $tag$ begin perform ';'; end $tag$;";
  const parts = statements(sql);
  assert.equal(parts.length, 2);
  assert.match(withoutLeadingComments(parts[0].sql), /^create table/);
  assert.match(parts[0].sql, /'a;--b'/);
  assert.match(parts[1].sql, /perform ';'/);
  assert.equal(parts[1].line, 2);
  assert.doesNotMatch(sqlCode("create table x(a text default 'references fake'); -- references nope"), /references/);
});
test('every repository table gets exactly one definition and dependency references resolve', () => {
  const data = inventory();
  const names = new Set(data.tables.map(t => t.name));
  assert.equal(names.size, data.tableCount);
  for (const table of data.tables) {
    assert.match(table.definition, /^create table/i);
    assert.ok(table.definedIn.line > 0);
    for (const dependency of table.dependencies) assert.ok(names.has(dependency), `${table.name} -> ${dependency}`);
  }
  assert.equal([...generatedFiles(data).keys()].filter(f => f.includes('/tables/')).length, names.size);
  assert.deepEqual(data.tables.find(t => t.name === 'telegram_account_links').dependencies, ['users']);
  assert.ok(data.tables.find(t => t.name === 'telegram_account_links').rls.enable.length);
});
test('reconciliation separates extensions and reports missing tables and unsafe security state', () => {
  const result = reconcile({ tables: [{ name: 'users' }, { name: 'telegram_account_links' }], missingVersions: ['0040'] }, {
    tables: [
      { schema: 'public', name: 'users', rlsEnabled: true },
      { schema: 'public', name: 'spatial_ref_sys', extension: 'postgis', rlsEnabled: false },
      { schema: 'public', name: 'untracked', rlsEnabled: false },
      { schema: 'auth', name: 'users', rlsEnabled: false },
    ], functions: [{ name: 'unsafe', securityDefiner: true, execute: { anon: true } }],
  });
  assert.equal(result.livePublicTables, 3);
  assert.equal(result.liveApplicationTables, 2);
  assert.deepEqual(result.missingInStaging, ['telegram_account_links']);
  assert.deepEqual(result.stagingOnly, ['untracked']);
  assert.deepEqual(result.rlsDisabled, ['untracked']);
  assert.equal(result.publicExecutableDefiners.length, 1);
});
test('staging probe refuses absent, production and lookalike connection targets', () => {
  assert.throws(() => validateStagingUrl(''), /not configured/);
  for (const host of ['db.iyarllmcednkbekweucd.supabase.co', 'db.tvdyfwceiecxwgqhcsge.supabase.co.evil.test']) {
    assert.throws(() => validateStagingUrl(`postgres://readonly@example@${host}/postgres`), /not the verified/);
  }
  assert.ok(validateStagingUrl('postgres://readonly@db.tvdyfwceiecxwgqhcsge.supabase.co/postgres'));
  assert.ok(validateStagingUrl('postgres://readonly.tvdyfwceiecxwgqhcsge@aws-0-ap-south-1.pooler.supabase.com/postgres'));
});
test('staging probe rejects driver target overrides and TLS/read-only downgrades', () => {
  const direct = 'postgres://readonly@db.tvdyfwceiecxwgqhcsge.supabase.co/postgres';
  for (const query of [
    'host=db.iyarllmcednkbekweucd.supabase.co',
    'user=postgres.iyarllmcednkbekweucd',
    'options=-c%20default_transaction_read_only=off',
    'sslmode=disable', 'sslmode=no-verify', 'ssl=false',
    'sslmode=verify-full&sslmode=disable', 'uselibpqcompat=true',
  ]) assert.throws(() => validateStagingUrl(`${direct}?${query}`), /verified TLS/);
  assert.throws(() => validateStagingUrl(direct.replace('readonly@', '')), /explicit user/);
  assert.equal(new URL(validateStagingUrl(direct)).searchParams.get('sslmode'), 'verify-full');
});
