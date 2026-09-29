#!/usr/bin/env node
// ---------------------------------------------------------------------------
// Testnet x402 settlement: preflight, then the execution checklist.
//
// WHY A PREFLIGHT AND NOT A TEST. A real settlement needs a funded key on a
// real chain. That cannot be faked, and a test that "verifies settlement"
// without one would be the single most misleading thing this audit could
// produce. So this script does the only honest thing available without
// credentials: it reports exactly which prerequisites are present, which are
// missing, and what each missing one blocks.
//
// WITH credentials it goes further — it checks the chain is reachable, the key
// is funded, the pinned asset exists at the configured address, and the gas
// ceiling is plausible — and then prints the exact sequence to run. It
// deliberately stops short of broadcasting: moving value, even testnet value,
// is a decision a person makes, not a side effect of running a verification
// script.
//
// MAINNET IS REFUSED OUTRIGHT. Not gated behind a flag — refused.
//
// USAGE
//   BASE_SEPOLIA_RPC_URL=https://... \
//   FACILITATOR_PRIVATE_KEY=0x... \
//   node apps/web/scripts/testnet-settlement-preflight.mjs
// ---------------------------------------------------------------------------

const TESTNETS = {
  "base-sepolia": {
    chainId: 84532,
    rpcEnv: "BASE_SEPOLIA_RPC_URL",
    usdc: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    faucet: "https://faucet.circle.com (USDC) + https://www.alchemy.com/faucets/base-sepolia (gas)",
  },
  "arbitrum-sepolia": {
    chainId: 421614,
    rpcEnv: "ARBITRUM_SEPOLIA_RPC_URL",
    usdc: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
    faucet: "https://faucet.circle.com (USDC) + https://www.alchemy.com/faucets/arbitrum-sepolia (gas)",
  },
};

const MAINNET_CHAIN_IDS = [1, 42161, 8453, 137, 43114, 10];
const GAS_CEILING = 200_000n;

const target = process.argv[2] ?? "base-sepolia";
const net = TESTNETS[target];
if (!net) {
  console.error(`\n  Unknown target "${target}". Choose one of: ${Object.keys(TESTNETS).join(", ")}\n`);
  process.exit(2);
}

const rpc = process.env[net.rpcEnv] ?? "";
const key = process.env.FACILITATOR_PRIVATE_KEY ?? process.env.FURLPAY_SETTLER_PRIVATE_KEY ?? "";
const kms = process.env.FURLPAY_KMS_PROVIDER ?? "";

const rows = [];
const need = (label, ok, detail) => {
  rows.push({ label, ok, detail });
  console.log(`  ${ok ? "PRESENT " : "MISSING "} ${label.padEnd(34)} ${detail ?? ""}`);
  return ok;
};

console.log(`\n  x402 testnet settlement preflight — ${target} (chain ${net.chainId})\n`);

const haveRpc = need(net.rpcEnv, Boolean(rpc), rpc ? "configured" : "no RPC endpoint");
const haveSigner = need(
  "a signer (key or KMS)",
  Boolean(key || kms),
  key ? "FACILITATOR_PRIVATE_KEY set" : kms ? `KMS: ${kms}` : "neither FACILITATOR_PRIVATE_KEY nor FURLPAY_KMS_PROVIDER"
);
need("pinned USDC address", true, net.usdc);
need("ONCHAIN_SETTLEMENT_LIVE", process.env.ONCHAIN_SETTLEMENT_LIVE === "1", process.env.ONCHAIN_SETTLEMENT_LIVE ?? "unset (settlement stays simulated)");

if (!haveRpc || !haveSigner) {
  console.log(`
  ----------------------------------------------------------------------
  TESTNET SETTLEMENT: NOT PERFORMED — EXTERNAL DEPENDENCY

  Nothing in this repository can supply the missing items, and no part of
  this run may be reported as a settlement. The system remains fail-closed:
  \`liveRails()\` is empty, no rail adapter is registered, and
  /api/v1/payments/execute answers 503 rail_not_connected.

  TO CLOSE THIS GAP, in order:

    1. Fund a testnet account.
         gas:  ${net.faucet.split("+")[1]?.trim() ?? net.faucet}
         USDC: ${net.faucet.split("+")[0]?.trim()}
       Needs only a few cents of gas and ~1 USDC.

    2. Export the prerequisites.
         export ${net.rpcEnv}=https://<your-endpoint>
         export FACILITATOR_PRIVATE_KEY=0x<testnet-key-only>
         export FACILITATOR_EVM_ADDRESS=0x<that-key's-address>
         export ONCHAIN_SETTLEMENT_LIVE=1

    3. Re-run this preflight. It will verify reachability, chain id, the
       signer's balance, and that the pinned USDC contract actually exists
       at the configured address.

    4. Then drive the lifecycle and capture, for the audit:
         quote -> authorization -> verify -> settle -> broadcast
           -> receipt -> confirmation depth -> settlement record -> evidence

       Record: transaction hash, gasUsed, effectiveGasPrice, total cost,
       time to N confirmations, and whether gasUsed leaves meaningful
       headroom under the ${GAS_CEILING} ceiling in x402Assets
       (settlementGasLimit). An EIP-3009 transferWithAuthorization on an L2
       is typically 55k-90k, so the ceiling is expected to be generous —
       but "expected" is not "observed", and only step 4 makes it observed.

    5. Re-run the same settlement a second time with the SAME authorization
       and confirm it is REFUSED, not repeated. A nonce that can be burned
       twice is a double spend.
  ----------------------------------------------------------------------
`);
  process.exit(1);
}

// ── With credentials: verify the chain before anything is signed ───────────
const rpcCall = async (method, params = []) => {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
};

try {
  const chainIdHex = await rpcCall("eth_chainId");
  const chainId = Number(BigInt(chainIdHex));
  console.log();
  if (MAINNET_CHAIN_IDS.includes(chainId)) {
    console.error(`  REFUSED: chain ${chainId} is MAINNET. This script never targets mainnet.\n`);
    process.exit(2);
  }
  need("chain id matches the target", chainId === net.chainId, `${chainId} (expected ${net.chainId})`);

  const code = await rpcCall("eth_getCode", [net.usdc, "latest"]);
  need("pinned USDC contract is deployed", code && code !== "0x", `${String(code).length} bytes of code`);

  const addr = process.env.FACILITATOR_EVM_ADDRESS ?? "";
  if (addr) {
    const balHex = await rpcCall("eth_getBalance", [addr, "latest"]);
    const wei = BigInt(balHex);
    need("signer has gas", wei > 0n, `${wei} wei`);

    // USDC balanceOf(address)
    const data = "0x70a08231" + addr.replace(/^0x/, "").toLowerCase().padStart(64, "0");
    const bal = await rpcCall("eth_call", [{ to: net.usdc, data }, "latest"]);
    const usdc = BigInt(bal ?? "0x0");
    need("signer holds testnet USDC", usdc > 0n, `${usdc} atomic (6dp)`);
  } else {
    need("FACILITATOR_EVM_ADDRESS", false, "unset — cannot check balances");
  }

  const gasPrice = BigInt(await rpcCall("eth_gasPrice"));
  const worstCase = gasPrice * GAS_CEILING;
  console.log(`\n  gas price ${gasPrice} wei · ceiling ${GAS_CEILING} · worst-case ${worstCase} wei`);

  const blocked = rows.filter((r) => !r.ok);
  console.log(`\n  -----------------------------------------`);
  if (blocked.length) {
    console.log(`  NOT READY: ${blocked.map((r) => r.label).join(", ")}`);
    process.exit(1);
  }
  console.log(`  READY. Every prerequisite is present.

  This script does NOT broadcast. Moving value — testnet or not — is a
  decision a person makes, not a side effect of a verification run. Drive the
  lifecycle deliberately and capture the receipt.
`);
} catch (e) {
  console.error(`\n  RPC error: ${e.message}\n`);
  process.exit(3);
}
