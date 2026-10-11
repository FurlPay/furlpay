// ---------------------------------------------------------------------------
// Pre-flight for merchant payments + payroll on an environment, run BEFORE
// applying 0040-0042 or deploying.
//
//   npm run merchant:check-env                                   # current shell env
//   npx tsx --env-file=.env.staging scripts/check-merchant-env.mts
//
// Every check is a live probe, not a presence test: keys are decoded, RPCs are
// asked for their chainId, a configured router must have bytecode on its chain
// and report the chain's native USDC (lib/payments/merchant/registry.ts) and not
// be paused. Exit 1 when anything REQUIRED fails. Secrets are never printed.
// ---------------------------------------------------------------------------
import { paymentChain } from "../src/lib/payments/merchant/registry";
import { ROUTER_CHAINS, configuredRouter, routerEnvName } from "../src/lib/services/routerConfig";
import { verifySuiChain } from "../src/lib/payments/merchant/sui";

type Row = { check: string; status: "ok" | "fail" | "warn"; detail: string; required: boolean };
const rows: Row[] = [];
const add = (check: string, status: Row["status"], detail: string, required = true) => rows.push({ check, status, detail, required });
const env = process.env;

function key32(name: string, required = true) {
  const raw = (env[name] ?? "").trim();
  if (!raw) return add(name, "fail", "unset", required);
  const bytes = Buffer.from(raw, "base64");
  add(name, bytes.length === 32 ? "ok" : "fail", bytes.length === 32 ? "32-byte base64 key" : `decodes to ${bytes.length} bytes, need 32`, required);
}

async function rpc(url: string, method: string, params: unknown[] = []) {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), signal: AbortSignal.timeout(8000) });
  const body = await res.json() as { result?: string; error?: { message: string } };
  if (body.error || body.result === undefined) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  return body.result;
}

async function main() {
  key32("FURLPAY_PARTNER_WEBHOOK_KEY");
  key32("FURLPAY_TAX_ENCRYPTION_KEY");
  if (env.FURLPAY_TAX_ENCRYPTION_KEY && env.FURLPAY_TAX_ENCRYPTION_KEY === env.FURLPAY_PARTNER_WEBHOOK_KEY) add("key separation", "fail", "tax and webhook keys are identical");
  const cron = (env.CRON_SECRET || env.FURLPAY_CRON_SECRET || "").trim();
  add("CRON_SECRET / FURLPAY_CRON_SECRET", cron.length >= 16 ? "ok" : "fail", cron ? (cron.length >= 16 ? `${cron.length} chars` : "shorter than 16 chars") : "unset: crons refuse every call");
  add("SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY", env.SUPABASE_URL && env.SUPABASE_SERVICE_ROLE_KEY ? "ok" : "fail", env.SUPABASE_URL ? new URL(env.SUPABASE_URL).host : "unset");

  for (const id of ["arbitrum", "base", "arc", "polygon", "ethereum"] as const) {
    const c = paymentChain(id);
    const custom = c.env ? env[c.env]?.trim() : "";
    const url = custom || c.rpc;
    try {
      const got = Number(BigInt(await rpc(url, "eth_chainId")));
      add(`${c.env ?? id} RPC`, got === c.chainId ? (custom ? "ok" : "warn") : "fail", got === c.chainId ? (custom ? `chainId ${got}` : `unset; public fallback ${new URL(c.rpc).host} answers (rate limited)`) : `answers chainId ${got}, expected ${c.chainId}`, id === "arbitrum" || id === "arc");
    } catch (e) { add(`${c.env ?? id} RPC`, "fail", `unreachable: ${(e as Error).message.slice(0, 60)}`, id === "arbitrum" || id === "arc"); }
  }

  // Sui collection reads GraphQL (JSON-RPC was retired on mainnet, July 2026).
  try {
    await verifySuiChain();
    add("SUI_GRAPHQL_URL", env.SUI_GRAPHQL_URL ? "ok" : "warn", env.SUI_GRAPHQL_URL ? "Sui mainnet" : "unset; public graphql.mainnet.sui.io answers (rate limited)", false);
  } catch (e) { add("SUI_GRAPHQL_URL", "fail", `not Sui mainnet or unreachable: ${(e as Error).message.slice(0, 60)}`, false); }

  let anyRouter = false;
  for (const chain of ROUTER_CHAINS) {
    const router = configuredRouter(chain, env);
    const name = routerEnvName(chain) + (chain === "arbitrum" ? " (or FURLPAY_ROUTER_ADDRESS)" : "");
    if (!router) { add(name, "warn", "unset: payroll on this chain answers 503", false); continue; }
    anyRouter = true;
    if (!/^0x[0-9a-fA-F]{40}$/.test(router)) { add(name, "fail", "not an address"); continue; }
    const c = paymentChain(chain);
    const url = (c.env && env[c.env]?.trim()) || c.rpc;
    try {
      const code = await rpc(url, "eth_getCode", [router, "latest"]);
      if (!code || code === "0x") { add(name, "fail", `no contract at ${router} on ${chain}`); continue; }
      const usdc = `0x${(await rpc(url, "eth_call", [{ to: router, data: "0x3e413bee" }, "latest"])).slice(-40)}`; // usdc()
      if (usdc.toLowerCase() !== c.token.toLowerCase()) { add(name, "fail", `router.usdc() is ${usdc}, expected native USDC ${c.token}`); continue; }
      const paused = BigInt(await rpc(url, "eth_call", [{ to: router, data: "0x5c975abb" }, "latest"])) !== 0n; // paused()
      add(name, paused ? "fail" : "ok", paused ? "router is PAUSED" : `deployed, native USDC, not paused`);
    } catch (e) { add(name, "fail", `probe failed: ${(e as Error).message.slice(0, 60)}`); }
  }
  if (!anyRouter) add("FurlPayRouter (any chain)", "fail", "none configured: payroll cannot be submitted in production");

  const width = Math.max(...rows.map(r => r.check.length));
  const mark = { ok: "\u001b[32m OK \u001b[0m", warn: "\u001b[33mWARN\u001b[0m", fail: "\u001b[31mFAIL\u001b[0m" };
  for (const r of rows) console.log(`${mark[r.status]}  ${r.check.padEnd(width)}  ${r.detail}${!r.required && r.status === "fail" ? " (optional)" : ""}`);
  const blocking = rows.filter(r => r.required && r.status === "fail");
  console.log(blocking.length ? `\n${blocking.length} required check(s) failed.` : "\nAll required checks passed.");
  process.exit(blocking.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
