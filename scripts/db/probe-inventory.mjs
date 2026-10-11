#!/usr/bin/env node
// STAGING_DATABASE_URL must be configured outside source control. Never falls back
// to DATABASE_URL or production. The Supabase project is checked before connecting.
import pg from 'pg';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventory } from './inventory.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const STAGING_PROJECT = 'tvdyfwceiecxwgqhcsge';
export function validateStagingUrl(value) {
  if (!value) throw new Error('STAGING_DATABASE_URL is not configured');
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('Expected a PostgreSQL connection');
  // node-postgres lets query parameters override the URL authority and options.
  // Validate the complete connection, not just the hostname shown to an operator.
  const keys = [...url.searchParams.keys()];
  if (!url.username || url.hash || new Set(keys).size !== keys.length ||
      keys.some(key => !['sslmode', 'sslrootcert'].includes(key)) ||
      (url.searchParams.has('sslmode') && url.searchParams.get('sslmode') !== 'verify-full')) {
    throw new Error('Staging connection requires an explicit user and verified TLS; only sslmode=verify-full and sslrootcert query parameters are supported');
  }
  const direct = url.hostname === `db.${STAGING_PROJECT}.supabase.co`;
  const pooler = url.hostname.endsWith('.pooler.supabase.com') && decodeURIComponent(url.username).endsWith(`.${STAGING_PROJECT}`);
  if (!direct && !pooler) throw new Error('Connection is not the verified FurlPay staging project');
  url.searchParams.set('sslmode', 'verify-full');
  return url.toString();
}

export function reconcile(expected, catalog) {
  const tables = catalog.tables.filter(t => t.schema === 'public');
  const application = tables.filter(t => !t.extension);
  const names = new Set(application.map(t => t.name)), repo = new Set(expected.tables.map(t => t.name));
  return {
    repositoryTables: repo.size, livePublicTables: tables.length, liveApplicationTables: application.length,
    extensionTables: tables.filter(t => t.extension).map(t => ({ name: t.name, extension: t.extension })),
    missingInStaging: [...repo].filter(n => !names.has(n)).sort(),
    stagingOnly: [...names].filter(n => !repo.has(n)).sort(),
    rlsDisabled: application.filter(t => !t.rlsEnabled).map(t => t.name),
    publicRolePolicies: application.filter(t => t.policies?.length).map(t => ({ table: t.name, policies: t.policies })),
    missingMigrationVersions: expected.missingVersions,
    foreignKeysWithoutLeadingIndex: catalog.foreignKeysWithoutLeadingIndex ?? [],
    publicExecutableDefiners: (catalog.functions ?? []).filter(f => f.securityDefiner && (f.execute?.anon || f.execute?.authenticated)),
    publicReadableViews: (catalog.views ?? []).filter(v => v.select?.anon || v.select?.authenticated),
    migrationHistory: catalog.migrationHistory ?? null,
    note: 'Table presence does not prove later ALTER migrations were applied. Compare migration history and catalog definitions before proposing DDL.',
  };
}

async function main() {
  const snapshotIdx = process.argv.indexOf('--snapshot');
  const outputIdx = process.argv.indexOf('--output');
  let catalog;
  if (snapshotIdx !== -1) {
    const snapshot = JSON.parse(readFileSync(process.argv[snapshotIdx + 1], 'utf8'));
    catalog = snapshot.catalog ?? snapshot;
  }
  else {
    const connectionString = validateStagingUrl(process.env.STAGING_DATABASE_URL);
    const client = new pg.Client({ connectionString, connectionTimeoutMillis: 5_000,
      options: '-c default_transaction_read_only=on -c statement_timeout=10000' });
    try {
      await client.connect();
      const results = await client.query(readFileSync(resolve(ROOT, 'scripts/db/schema-catalog.sql'), 'utf8'));
      catalog = results.find(r => r.rows?.[0]?.catalog)?.rows[0].catalog;
      await client.query('begin transaction read only');
      const history = (await client.query("select to_regclass('supabase_migrations.schema_migrations') is not null present")).rows[0].present;
      catalog.migrationHistory = history ? (await client.query('select version, name from supabase_migrations.schema_migrations order by version')).rows : null;
      await client.query('rollback');
    } finally { await client.end(); }
  }
  if (!Array.isArray(catalog?.tables)) throw new Error('Invalid catalog snapshot');
  const result = { environment: snapshotIdx === -1 ? 'staging' : 'unverified offline snapshot',
    projectRef: snapshotIdx === -1 ? STAGING_PROJECT : null, liveVerification: snapshotIdx === -1,
    checkedAt: new Date().toISOString(), ...reconcile(inventory(), catalog) };
  if (outputIdx !== -1) writeFileSync(process.argv[outputIdx + 1], JSON.stringify({ result, catalog }, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
  if (result.missingInStaging.length || result.stagingOnly.length || result.rlsDisabled.length || result.publicRolePolicies.length || result.publicExecutableDefiners.length || result.publicReadableViews.length) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => {
  // Database/provider errors can include connection details; only local validation
  // messages and SQLSTATE codes are safe to print here.
  const known = ['STAGING_DATABASE_URL is not configured', 'Connection is not the verified FurlPay staging project', 'Expected a PostgreSQL connection', 'Invalid catalog snapshot',
    'Staging connection requires an explicit user and verified TLS; only sslmode=verify-full and sslrootcert query parameters are supported'];
  console.error(known.includes(error.message) ? error.message : `Catalog probe failed (${typeof error.code === 'string' && /^[A-Z0-9_]{1,30}$/.test(error.code) ? error.code : 'unavailable'}); check staging access locally.`);
  process.exitCode = 1;
});
