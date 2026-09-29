// Audit-only, offline reproduction. Does not deploy or contact a provider.
// Run from the repository root: node audit/2026-09-29-furlpay/evidence/deploy-and-backend-proof.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { stripTypeScriptTypes } from 'node:module';
import vm from 'node:vm';
import { pathToFileURL } from 'node:url';

const root = process.cwd();
const fixture = mkdtempSync(join(tmpdir(), 'furlpay-audit-gate-'));
const git = (...args) => execFileSync('git', args, { cwd: fixture, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
git('init', '--initial-branch=extension-redesign');
writeFileSync(join(fixture, 'README.md'), 'Offline audit fixture only.\n');
git('add', 'README.md');
git('-c', 'user.name=Offline Audit', '-c', 'user.email=audit@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-m', 'Fixture');
const sha = git('rev-parse', 'HEAD');
mkdirSync(join(fixture, 'apps/web/src/app/api/audit-unreviewed'), { recursive: true });
writeFileSync(join(fixture, 'apps/web/src/app/api/audit-unreviewed/route.ts'), 'export const GET = () => new Response("not in the approved commit");\n');
const fullStatus = git('status', '--porcelain', '--untracked-files=all');
const gateStatus = git('status', '--porcelain', '--untracked-files=no');
assert.match(fullStatus, /audit-unreviewed/);
assert.equal(gateStatus, '');
const { checkReleaseBranch } = await import(pathToFileURL(resolve(root, 'apps/web/scripts/releaseBranch.mjs')).href);
const source = readFileSync(resolve(root, 'apps/web/scripts/check-deploy-gate.mjs'), 'utf8')
  .replace(/^import .*;\r?$/gm, '');
const output = [];
vm.runInNewContext(source, {
  execFileSync(binary, args) {
    if (binary === 'git' && args[0] === 'ls-remote') return `${sha}\trefs/heads/extension-redesign\n`;
    if (binary === 'git') return `${git(...args)}\n`;
    if (binary === 'gh') return JSON.stringify([{ status: 'completed', conclusion: 'success', headSha: sha, databaseId: 1, url: 'https://example.invalid/offline-ci-fixture' }]);
    throw new Error(`Unexpected command ${binary}`);
  },
  checkReleaseBranch: branch => checkReleaseBranch(branch, {}),
  process: { env: {}, exit: code => { throw new Error(`Gate exited ${code}`); } },
  console: { log: message => output.push(message), warn: message => output.push(message), error: message => output.push(message) },
}, { filename: 'check-deploy-gate.mjs', timeout: 15000 });
assert.ok(output.some(line => line.includes('Safe to deploy.')));
console.log(JSON.stringify({ proof: 'untracked-source-excluded-by-deploy-gate', fullStatus, gateStatus, gatePassed: true, remoteAndCi: 'mocked successful exact SHA', deployed: false, fixture }, null, 2));

// Exercise the actual dependency-free backend modules with the names emitted
// by compute.tf. No real credentials are used. Prohibit all network access.
const keys = ['NODE_ENV', 'DATABASE_URL', 'REDIS_URL', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'UPSTASH_REDIS_REST_URL', 'UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_URL', 'KV_REST_API_TOKEN'];
const saved = new Map(keys.map(key => [key, process.env[key]]));
const savedFetch = globalThis.fetch;
try {
  for (const key of keys) delete process.env[key];
  process.env.NODE_ENV = 'production';
  process.env.DATABASE_URL = 'postgresql://offline:offline@127.0.0.1:1/audit';
  process.env.REDIS_URL = 'rediss://:offline@127.0.0.1:1';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'offline-fixture-not-a-credential';
  globalThis.fetch = () => { throw new Error('Network forbidden by audit harness'); };
  const load = async relative => {
    const js = stripTypeScriptTypes(readFileSync(resolve(root, relative), 'utf8'));
    return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
  };
  const kv = await load('apps/web/src/lib/kv.ts');
  const db = await load('apps/web/src/lib/supabase.ts');
  assert.equal(kv.kvBackend, 'memory');
  assert.equal(db.supabaseBackend, 'none');
  await assert.rejects(kv.kvGet('offline-audit'), /refusing the in-memory fallback in production/);
  console.log(JSON.stringify({ proof: 'aws-backend-config-mismatch', kvBackend: kv.kvBackend, supabaseBackend: db.supabaseBackend, productionKvOperation: 'refused', networkCalls: 0 }, null, 2));
} finally {
  globalThis.fetch = savedFetch;
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
