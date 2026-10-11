#!/usr/bin/env node
// Generate reviewable table definitions WITHOUT introducing a second migration chain.
// node scripts/db/inventory.mjs [--check]
import { readFileSync, readdirSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, relative, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import ts from 'typescript';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const slash = p => p.replaceAll('\\', '/');
const ID = '(?:"[^"]+"|[a-z_][a-z_0-9]*)';
const RELATION = `(${ID}(?:\\.${ID})?)`;
const nameOf = s => s.replaceAll('"', '').replace(/^public\./, '');

/** Split PostgreSQL, preserving dollar bodies, quoted strings and source lines. */
export function statements(sql) {
  const result = [];
  let start = 0, line = 1, startLine = 1, quote = '', dollar = '', comment = 0;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i], next = sql[i + 1];
    if (c === '\n') line++;
    if (comment === -1) { if (c === '\n') comment = 0; continue; }
    if (comment > 0) {
      if (c === '/' && next === '*') { comment++; i++; }
      else if (c === '*' && next === '/') { comment--; i++; }
      continue;
    }
    if (dollar) { if (sql.startsWith(dollar, i)) { i += dollar.length - 1; dollar = ''; } continue; }
    if (quote) {
      if (c === quote && next === quote) { i++; continue; }
      if (c === quote) quote = '';
      continue;
    }
    if (c === '-' && next === '-') { comment = -1; i++; continue; }
    if (c === '/' && next === '*') { comment = 1; i++; continue; }
    if (c === "'" || c === '"') { quote = c; continue; }
    const tag = c === '$' ? /^\$(?:[a-z_][a-z_0-9]*)?\$/i.exec(sql.slice(i)) : null;
    if (tag) { dollar = tag[0]; i += dollar.length - 1; continue; }
    if (c === ';') { result.push({ sql: sql.slice(start, i + 1), line: startLine }); start = i + 1; startLine = line; }
  }
  if (sql.slice(start).trim()) result.push({ sql: sql.slice(start), line: startLine });
  return result;
}

// Only strip leading comments: removing -- inside a string would corrupt a definition.
export function withoutLeadingComments(sql) {
  return sql.replace(/^(?:\s+|--[^\n]*(?:\n|$)|\/\*[\s\S]*?\*\/)+/, '');
}

/** Mask comments and SQL string bodies before interpreting static DDL tokens. */
export function sqlCode(sql) {
  return sql.replace(/--[^\n]*|\/\*[\s\S]*?\*\/|'(?:''|[^'])*'|\$([a-z_][a-z_0-9]*|)\$[\s\S]*?\$\1\$/gi,
    text => text.replace(/[^\n]/g, ' '));
}

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (['node_modules', 'dist', '.next', '__tests__', 'scratch'].includes(e.name)) return [];
    const p = join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.(?:[cm]?[jt]sx?)$/.test(e.name) && !/\.(spec|test)\./.test(e.name) ? [p] : [];
  }).sort();
}

export function inventory(root = ROOT) {
  const files = readdirSync(join(root, 'supabase/migrations')).filter(f => /^\d{4}_.*\.sql$/.test(f)).sort();
  const tables = new Map(), views = new Map(), extensions = new Set(), all = [];
  for (const file of files) {
    const path = `supabase/migrations/${file}`;
    for (const stmt of statements(readFileSync(join(root, path), 'utf8').replaceAll('\r\n', '\n'))) {
      const text = withoutLeadingComments(stmt.sql);
      const line = stmt.line + stmt.sql.slice(0, stmt.sql.indexOf(text)).split('\n').length - 1;
      const source = { file: path, line, sha256: createHash('sha256').update(text.trim()).digest('hex') };
      all.push({ text, source });
      const view = new RegExp(`^create\\s+(?:or\\s+replace\\s+)?(?:materialized\\s+)?view\\s+${RELATION}`, 'i').exec(text);
      if (view) views.set(nameOf(view[1]), { name: nameOf(view[1]), definedIn: source });
      const extension = /^create\s+extension\s+(?:if\s+not\s+exists\s+)?([^\s;]+)/i.exec(text);
      if (extension) extensions.add(extension[1]);
      const match = new RegExp(`^create\\s+table\\s+(?:if\\s+not\\s+exists\\s+)?${RELATION}`, 'i').exec(text);
      if (!match) continue;
      const name = nameOf(match[1]);
      if (tables.has(name)) throw new Error(`Duplicate table definition: ${name} in ${path}`);
      tables.set(name, { name, schema: 'public', definedIn: source, definition: text.trim(), dependencies: [], schemaStatements: [], applicationReferences: [], rls: { enable: [], disable: [], policies: [] } });
    }
  }
  for (const table of tables.values()) {
    const relationPattern = new RegExp(`(?<![a-z_0-9])${table.name}(?![a-z_0-9])`, 'i');
    for (const { text, source } of all) {
      if (!relationPattern.test(text)) continue;
      const kind = /^create\s+(?:or\s+replace\s+)?function/i.test(text) ? 'function'
        : /^do\b/i.test(text) ? 'procedural' : text.split(/\s+/).slice(0, 2).join(' ').toLowerCase();
      table.schemaStatements.push({ ...source, kind });
      // Direct DDL is distinguished from procedural evidence requiring a live catalog check.
      const alters = new RegExp(`^alter\\s+table\\s+(?:if\\s+exists\\s+)?(?:public\\.)?"?${table.name}"?\\s`, 'i').test(text);
      if (alters && /enable\s+row\s+level\s+security/i.test(text)) table.rls.enable.push(source);
      if (alters && /disable\s+row\s+level\s+security/i.test(text)) table.rls.disable.push(source);
      if (/^create\s+policy\b/i.test(text)) table.rls.policies.push(source);
      if (source === table.definedIn || alters) {
        for (const match of sqlCode(text).matchAll(new RegExp(`\\breferences\\s+${RELATION}`, 'gi'))) table.dependencies.push(nameOf(match[1]));
      }
    }
    table.dependencies = [...new Set(table.dependencies)].sort();
  }
  const unresolvedCalls = [], missingDefinitions = [];
  for (const file of ['apps/web/src', 'packages', 'chaintracker/src'].flatMap(p => walk(join(root, p)))) {
    const code = readFileSync(file, 'utf8'), source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, true);
    const constants = new Map();
    function constantsVisitor(node) {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isStringLiteralLike(node.initializer)) constants.set(node.name.text, node.initializer.text);
      ts.forEachChild(node, constantsVisitor);
    }
    constantsVisitor(source);
    function visit(node) {
      const location = { file: slash(relative(root, file)), line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 };
      if (ts.isStringLiteralLike(node) && tables.has(node.text)) tables.get(node.text).applicationReferences.push(location);
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && /^sb(?:Select|Insert|Upsert|Update|Delete|Count)$/.test(node.expression.text)) {
        const arg = node.arguments[0];
        const table = arg && (ts.isStringLiteralLike(arg) ? arg.text : ts.isIdentifier(arg) ? constants.get(arg.text) : undefined);
        if (table && tables.has(table)) tables.get(table).applicationReferences.push(location);
        else if (table) { if (!views.has(table)) missingDefinitions.push({ table, ...location }); }
        else unresolvedCalls.push({ expression: arg?.getText(source), ...location });
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
  }
  for (const t of tables.values()) t.applicationReferences = [...new Map(t.applicationReferences.map(r => [`${r.file}:${r.line}`, r])).values()];
  const versions = new Set(files.map(f => Number(f.slice(0, 4))));
  const missingVersions = Array.from({ length: Math.max(...versions) }, (_, i) => i + 1).filter(v => !versions.has(v)).map(v => String(v).padStart(4, '0'));
  return { formatVersion: 1, scope: 'public tables explicitly defined by this branch; extension tables are separate', tableCount: tables.size, migrations: files, missingVersions, extensions: [...extensions].sort(), views: [...views.values()].sort((a, b) => a.name.localeCompare(b.name)), tables: [...tables.values()].sort((a, b) => a.name.localeCompare(b.name)), missingDefinitions, unresolvedCalls };
}

export function generatedFiles(data) {
  const out = new Map();
  for (const table of data.tables) out.set(`supabase/schema/tables/${table.name}.json`, JSON.stringify(table, null, 2) + '\n');
  out.set('supabase/schema/inventory.json', JSON.stringify({ ...data, tables: data.tables.map(({ name, definedIn, dependencies }) => ({ name, definedIn, dependencies, file: `tables/${name}.json` })) }, null, 2) + '\n');
  out.set('supabase/schema/README.md', `# Supabase table inventory\n\nGenerated by \`node scripts/db/inventory.mjs\`. Check drift with \`node scripts/db/inventory.mjs --check\`.\n\n${data.tableCount} application tables, ${data.migrations.length} migrations. Missing migration versions: ${data.missingVersions.join(', ') || 'none'}.\n\nThe JSON files are table definition dossiers, not executable migrations. Each preserves the original CREATE TABLE SQL and points to every subsequent schema statement and statically resolved application reference. Apply only the canonical migration chain after review; never apply these files or edit an applied migration. Procedural DDL and dynamic application calls are recorded for review, not silently treated as verified. Indexes, foreign keys, grants, policies and functions are referenced by exact source line and statement hash. RLS evidence here is static; use the read-only catalog probe to establish effective permissions.\n\nExtension-owned tables (for example PostGIS \`spatial_ref_sys\`) do not receive duplicate application definitions. The separate SQLite model in \`chaintracker/src/db/schema.ts\` is not part of the Supabase public schema.\n\n| Table | Defining migration | Foreign-key dependencies | Definition file |\n| --- | --- | --- | --- |\n${data.tables.map(t => `| ${t.name} | [${t.definedIn.file.split('/').at(-1)}:${t.definedIn.line}](../${t.definedIn.file.replace('supabase/', '')}) | ${t.dependencies.join(', ') || '—'} | [JSON](tables/${t.name}.json) |`).join('\n')}\n`);
  return out;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const data = inventory(), check = process.argv.includes('--check'), drift = [];
  const files = generatedFiles(data);
  for (const [file, content] of files) {
    const path = join(ROOT, file);
    if (check) { if (!existsSync(path) || readFileSync(path, 'utf8') !== content) drift.push(file); }
    else { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content); }
  }
  const tableDir = join(ROOT, 'supabase/schema/tables');
  if (existsSync(tableDir)) for (const file of readdirSync(tableDir)) if (!files.has(`supabase/schema/tables/${file}`)) drift.push(`stale: ${file}`);
  console.log(JSON.stringify({ tables: data.tableCount, migrations: data.migrations.length, missingVersions: data.missingVersions, missingDefinitions: data.missingDefinitions, unresolvedCalls: data.unresolvedCalls, drift }, null, 2));
  if (drift.length) process.exitCode = 1;
}
