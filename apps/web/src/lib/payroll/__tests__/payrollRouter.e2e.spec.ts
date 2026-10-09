import { beforeAll, describe, expect, it, vi } from "vitest";
import { createPublicClient, createWalletClient, encodeFunctionData, http, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";

// END-TO-END against a real FurlPayRouter on a LOCAL node (never a real network):
//
//   cd packages/contracts
//   npx hardhat node --config hardhat.config.localpayroll.ts --port 8546
//   npx hardhat run scripts/deploy-router-local.ts --config hardhat.config.localpayroll.ts --network localhost
//   PAYROLL_E2E_RPC=http://127.0.0.1:8546 PAYROLL_E2E_ROUTER=0x… PAYROLL_E2E_USDC=0x… npx vitest run payrollRouter.e2e
//
// It drives the app's own code: createPayment builds the EIP-712 payloads,
// recoverPayrollSigner checks the signatures, the employer's wallet approves
// and calls batchPay, and recordExecution marks lines paid from the receipt.
const RPC = process.env.PAYROLL_E2E_RPC, ROUTER = process.env.PAYROLL_E2E_ROUTER, USDC = process.env.PAYROLL_E2E_USDC;
const run = RPC && ROUTER && USDC ? describe : describe.skip;

const store = vi.hoisted(() => ({ batches: [] as Record<string, unknown>[], lines: [] as Record<string, unknown>[] }));
vi.mock("@/lib/supabase", () => {
  const rows = (t: string) => t === "payroll_batches" ? store.batches : store.lines;
  const filters = (q: string) => [...q.matchAll(/(\w+)=(eq|is)\.([^&]+)/g)].map(m => [m[1], m[2], decodeURIComponent(m[3])] as const);
  const match = (r: Record<string, unknown>, q: string) => filters(q).every(([k, op, v]) => op === "is" ? r[k] == null : String(r[k]) === v);
  return {
    supabaseBackend: "supabase",
    sbSelect: vi.fn(async (t: string, q: string) => rows(t).filter(r => match(r, q))),
    sbUpdate: vi.fn(async (t: string, q: string, patch: object) => rows(t).filter(r => match(r, q)).map(r => Object.assign(r, patch))),
    sbRpc: vi.fn(), sbCount: vi.fn(), sbInsertIgnoreDuplicates: vi.fn(),
  };
});
vi.mock("@/lib/compliance/addressScreening", () => ({ screenAddressRisk: vi.fn() }));

const ERC20 = parseAbi(["function approve(address,uint256) returns (bool)", "function balanceOf(address) view returns (uint256)"]);
// Hardhat's published development keys (#1 employer). Local node only.
const employer = privateKeyToAccount("0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d");
const TREASURY = "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC";
const OWNER = "11111111-1111-4111-8111-111111111111", BATCH = "22222222-2222-4222-8222-222222222222";
const contractors = [["0x1000000000000000000000000000000000000001", 2_500_000_000n], ["0x1000000000000000000000000000000000000002", 1_234_567_891n], ["0x1000000000000000000000000000000000000003", 1n]] as const;

run("payroll on a real FurlPayRouter (local node, chainId 42161)", () => {
  // The describe body is evaluated even when skipped; the placeholder URL is never contacted.
  const url = RPC ?? "http://127.0.0.1:1";
  const chain = { id: 42161, name: "local-arbitrum", nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 }, rpcUrls: { default: { http: [url] } } };
  const pub = createPublicClient({ chain, transport: http(url) });
  const wallet = createWalletClient({ account: employer, chain, transport: http(url) });
  type Sd = import("../signing").SignData;
  let lines: { id: string; recipient: string; pay: bigint; signData: Sd; signature: `0x${string}` }[] = [];

  beforeAll(async () => {
    vi.stubEnv("FURLPAY_ROUTER_ADDRESS_ARBITRUM", ROUTER!);
    vi.stubEnv("ARBITRUM_RPC_URL", RPC!);
    const { createPayment } = await import("@/lib/services/payments");
    const { lineFee, unitsToUsd } = await import("../pricing");
    const { recoverPayrollSigner } = await import("../signing");
    lines = await Promise.all(contractors.map(async ([recipient, pay], i) => {
      const fee = lineFee(pay);
      const { signData } = await createPayment({ amount: unitsToUsd(pay), sourceChain: "arbitrum", settlementChain: "arbitrum", units: { amount: pay + fee, fee }, recipient, userId: OWNER, idempotencyKey: `e2e:${Date.now()}:${i}` });
      const sd = signData as unknown as Sd;
      const signature = await employer.signTypedData({
        domain: { ...sd.domain, verifyingContract: sd.domain.verifyingContract as `0x${string}` }, types: sd.types, primaryType: "Payment",
        message: { ...sd.message, recipient: sd.message.recipient as `0x${string}`, nonce: sd.message.nonce as `0x${string}`, amount: BigInt(sd.message.amount), fee: BigInt(sd.message.fee), deadline: BigInt(sd.message.deadline) },
      });
      expect((await recoverPayrollSigner(sd, signature)).toLowerCase()).toBe(employer.address.toLowerCase());
      return { id: `4444444${i}-4444-4444-8444-444444444444`, recipient, pay, signData: sd, signature };
    }));
    store.batches.push({ id: BATCH, merchant_id: OWNER, cycle: "2026-10", chain: "arbitrum", status: "submitted", payer_address: employer.address });
    for (const l of lines) store.lines.push({ id: l.id, batch_id: BATCH, name: l.recipient, recipient: l.recipient, amount_units: l.pay.toString(), screening: "clear", payment_id: l.signData.message.paymentId, sign_data: l.signData, sign_deadline: new Date(l.signData.message.deadline * 1000).toISOString(), issue_count: 1, signature: l.signature, signer: employer.address, signed_at: new Date().toISOString(), executed_tx: null, executed_block: null, executed_at: null, created_at: new Date().toISOString() });
  }, 60_000);

  it("signs for the router's real EIP-712 domain on chain 42161", () => {
    for (const l of lines) expect(l.signData.domain).toEqual({ name: "FurlPayRouter", version: "1", chainId: 42161, verifyingContract: ROUTER });
  });

  it("executes the batch from the employer's wallet; contractors receive exactly their pay", async () => {
    const { ROUTER_ABI } = await import("../routerAbi");
    const total = lines.reduce((s, l) => s + BigInt(l.signData.message.amount), 0n);
    const before = await Promise.all(lines.map(l => pub.readContract({ address: USDC as `0x${string}`, abi: ERC20, functionName: "balanceOf", args: [l.recipient as `0x${string}`] })));
    const treasuryBefore = await pub.readContract({ address: USDC as `0x${string}`, abi: ERC20, functionName: "balanceOf", args: [TREASURY] });
    await pub.waitForTransactionReceipt({ hash: await wallet.sendTransaction({ to: USDC as `0x${string}`, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [ROUTER as `0x${string}`, total] }) }) });
    const data = encodeFunctionData({ abi: ROUTER_ABI, functionName: "batchPay", args: [
      lines.map(({ signData: { message: m } }) => ({ paymentId: m.paymentId, recipient: m.recipient as `0x${string}`, amount: BigInt(m.amount), fee: BigInt(m.fee), nonce: m.nonce as `0x${string}`, deadline: BigInt(m.deadline) })),
      lines.map(() => employer.address), lines.map(l => l.signature)] });
    const hash = await wallet.sendTransaction({ to: ROUTER as `0x${string}`, data });
    expect((await pub.waitForTransactionReceipt({ hash })).status).toBe("success");
    const after = await Promise.all(lines.map(l => pub.readContract({ address: USDC as `0x${string}`, abi: ERC20, functionName: "balanceOf", args: [l.recipient as `0x${string}`] })));
    lines.forEach((l, i) => expect(after[i] - before[i]).toBe(l.pay));
    const fees = lines.reduce((s, l) => s + BigInt(l.signData.message.fee), 0n);
    expect(await pub.readContract({ address: USDC as `0x${string}`, abi: ERC20, functionName: "balanceOf", args: [TREASURY] }) - treasuryBefore).toBe(fees);

    // The server marks lines paid only from the chain's own receipt.
    const { recordExecution } = await import("../execution");
    const out = await recordExecution(OWNER, BATCH, hash);
    expect(out).toMatchObject({ matched: 3, executed: 3, total: 3 });
    expect(store.batches[0].status).toBe("completed");
    expect(store.lines.every(l => l.executed_tx === hash.toLowerCase())).toBe(true);

    // The same authorizations cannot execute twice (on-chain nonce).
    await expect(wallet.sendTransaction({ to: ROUTER as `0x${string}`, data })).rejects.toThrow();
  }, 120_000);

  it("refuses to record a transaction that paid nothing of this batch", async () => {
    const { recordExecution } = await import("../execution");
    store.batches[0].status = "submitted";
    for (const l of store.lines) Object.assign(l, { executed_tx: null, executed_block: null, executed_at: null });
    const unrelated = await wallet.sendTransaction({ to: USDC as `0x${string}`, data: encodeFunctionData({ abi: ERC20, functionName: "approve", args: [ROUTER as `0x${string}`, 0n] }) });
    await pub.waitForTransactionReceipt({ hash: unrelated });
    await expect(recordExecution(OWNER, BATCH, unrelated)).rejects.toThrow("not sent to FurlPayRouter");
    expect(store.lines.every(l => l.executed_tx === null)).toBe(true);
  }, 60_000);
});
