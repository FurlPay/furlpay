#!/usr/bin/env node
// T-A1 — the ECS task definition and the application agree on env var NAMES.
//
//   node scripts/aws/check-env-contract.mjs [--write-doc]
//
// Sources:
//   infra/aws/env-contract.json          the contract (Terraform reads it too)
//   infra/aws/modules/env/compute.tf     what the task definition injects
//   apps/web/src/**                      what the application actually reads
//
// Fails when:
//   1. a contract variable is not read anywhere in the application code
//      (a name the app does not use is not a contract, it is a typo);
//   2. a REQUIRED variable is not injected by the task definition;
//   3. the task injects a name the app never reads (unless it is declared
//      terraform_only) — how SESSION_SECRET/EVM_RPC_URL/FCM_SERVICE_ACCOUNT_JSON
//      were injected while the app read other names;
//   4. DATABASE_URL / REDIS_URL are injected unconditionally;
//   5. docs/release/env-contract.json (the operator view) is not what
//      --write-doc would produce. Its read_in lists come from the code, so it
//      went stale silently before this check existed.
// --write-doc regenerates docs/release/env-contract.json.

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const contract = JSON.parse(readFileSync(join(ROOT, "infra/aws/env-contract.json"), "utf8"));
const compute = readFileSync(join(ROOT, "infra/aws/modules/env/compute.tf"), "utf8");

export function appEnvReads(srcDir) {
  const reads = new Map(); // name -> [files]
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) {
        if (name === "__tests__" || name === "node_modules") continue;
        walk(full);
      } else if (/\.(ts|tsx|mjs|js)$/.test(name) && !/\.(spec|test)\./.test(name)) {
        const code = readFileSync(full, "utf8");
        // process.env.NAME, env.NAME (typed env objects), env["NAME"], and the
        // lib/env.ts registry's v("NAME").
        const re = /(?:process\.env|\benv)\.([A-Z][A-Z0-9_]+)|\benv\[\s*["'`]([A-Z][A-Z0-9_]+)["'`]\s*\]|\bv\(\s*"([A-Z][A-Z0-9_]+)"/g;
        let m;
        while ((m = re.exec(code))) {
          const n = m[1] ?? m[2] ?? m[3];
          if (!reads.has(n)) reads.set(n, new Set());
          reads.get(n).add(relative(join(ROOT), full).split(sep).join("/"));
        }
      }
    }
  };
  walk(srcDir);
  return reads;
}

export function taskInjects(tf, contractSecretNames) {
  const plain = [...tf.matchAll(/\{\s*name\s*=\s*"([A-Z][A-Z0-9_]+)"\s*,\s*value\s*=/g)].map((m) => m[1]);
  const explicitSecrets = [...tf.matchAll(/\{\s*name\s*=\s*"([A-Z][A-Z0-9_]+)"\s*,\s*valueFrom\s*=/g)].map((m) => m[1]);
  // The app secret list is `toset(local.app_secret_names)`, i.e. the contract.
  const usesContract = /for_each\s*=\s*toset\(local\.app_secret_names\)/.test(tf);
  return { plain, explicitSecrets, appSecrets: usesContract ? contractSecretNames : [], usesContract };
}

export function check(contract, tf, reads) {
  const errors = [];
  const vars = contract.variables;
  const secretNames = vars.filter((v) => v.terraform === "secret").map((v) => v.name);
  const inj = taskInjects(tf, secretNames);
  if (!inj.usesContract) errors.push("compute.tf does not build app secrets from local.app_secret_names (the contract)");
  const injected = new Set([...inj.plain, ...inj.explicitSecrets, ...inj.appSecrets]);
  const terraformOnly = new Set(contract.terraform_only?.names ?? []);

  for (const v of vars) {
    if (!reads.has(v.name) && !["NODE_ENV", "PORT"].includes(v.name)) {
      errors.push(`contract variable ${v.name} is not read by the application`);
    }
    if (v.required && !injected.has(v.name)) errors.push(`required variable ${v.name} is not injected by the task definition`);
  }
  for (const name of injected) {
    if (terraformOnly.has(name) || ["NODE_ENV", "PORT"].includes(name)) continue;
    if ((contract.forbidden_unless_data_plane ?? []).includes(name)) continue;
    if (!reads.has(name)) errors.push(`task injects ${name}, which the application never reads`);
    if (!vars.some((v) => v.name === name)) errors.push(`task injects ${name}, which is not in the contract`);
  }
  for (const name of contract.forbidden_unless_data_plane ?? []) {
    // Gated form: `[for s in aws_secretsmanager_secret.x : { name = "X", valueFrom = s.arn }]`
    // (a counted resource yields an empty list when the data plane is off).
    const unconditional = tf
      .split(/\r?\n/)
      .some((line) => new RegExp(`\\{\\s*name\\s*=\\s*"${name}"\\s*,\\s*valueFrom`).test(line) && !/\[\s*for\s+\w+\s+in\s/.test(line));
    if (unconditional) errors.push(`${name} is injected unconditionally; it must be gated on var.enable_aws_data_plane`);
  }
  return errors;
}

function main() {
  const reads = appEnvReads(join(ROOT, "apps/web/src"));
  const errors = check(contract, compute, reads);
  {
    const doc = {
      generated_by: "scripts/aws/check-env-contract.mjs --write-doc",
      source: "infra/aws/env-contract.json",
      architecture: contract.architecture,
      variables: contract.variables.map((v) => ({
        application_variable: v.name,
        required: v.required,
        source: v.terraform === "secret" ? "Secrets Manager (placeholder, set out-of-band)" : v.terraform === "managed" ? "Secrets Manager (Terraform-generated)" : "ECS task environment",
        terraform_mapping:
          v.terraform === "secret"
            ? "aws_secretsmanager_secret.app[\"" + v.name + "\"]"
            : v.terraform === "managed"
              ? v.name === "ORIGIN_VERIFY_SECRET"
                ? "aws_secretsmanager_secret.origin_verify"
                : "aws_secretsmanager_secret.cron_secret"
              : "container environment",
        secrets_manager_name: v.terraform === "environment" ? null : `furlpay/<env>/${v.name}`,
        runtime_consumer: v.consumer,
        read_in: [...(reads.get(v.name) ?? [])].sort(),
      })),
    };
    const docPath = join(ROOT, "docs/release/env-contract.json");
    const want = JSON.stringify(doc, null, 2) + "\n";
    if (process.argv.includes("--write-doc")) writeFileSync(docPath, want);
    else if (readFileSync(docPath, "utf8").replace(/\r\n/g, "\n") !== want)
      errors.push("docs/release/env-contract.json is stale; run node scripts/aws/check-env-contract.mjs --write-doc");
  }
  if (errors.length) {
    console.error("Env contract check FAILED:");
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`Env contract OK: ${contract.variables.length} variables; task definition and application agree.`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main();
