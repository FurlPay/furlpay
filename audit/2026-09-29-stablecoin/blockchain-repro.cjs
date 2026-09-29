// Read-only audit reproduction: actual TypeScript modules, simulated boundaries.
// Run from repository root: node audit/2026-09-29-stablecoin/blockchain-repro.cjs
// No provider requests, credentials, blockchain submissions, or production writes.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const ROOT = path.resolve(__dirname, '../..');
const SRC = path.join(ROOT, 'apps/web/src');
const silentLog = { info() {}, warn() {}, error() {} };

function loader(mocks, env = {}, extra = {}) {
  const cache = new Map();
  function load(file) {
    file = path.resolve(file);
    if (cache.has(file)) return cache.get(file).exports;
    const module = { exports: {} };
    cache.set(file, module);
    const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
      fileName: file,
    }).outputText;
    function localRequire(id) {
      if (Object.hasOwn(mocks, id)) return mocks[id];
      if (id.startsWith('@/')) return load(path.join(SRC, id.slice(2)) + '.ts');
      if (id.startsWith('.')) return load(path.resolve(path.dirname(file), id) + '.ts');
      return require(id);
    }
    const context = vm.createContext({ module, exports: module.exports, require: localRequire,
      process: { env }, console, Date, Math, JSON, Buffer, URL, Map, Set, Uint8Array,
      setTimeout, clearTimeout, ...extra });
    new vm.Script(code, { filename: file }).runInContext(context);
    return module.exports;
  }
  return load;
}

async function replacementProof() {
  const original = '0x' + '11'.repeat(32);
  const cancellation = '0x' + '22'.repeat(32);
  const addr = '0x' + '33'.repeat(20);
  const token = '0x' + '44'.repeat(20);
  let submitted = 0;
  const load = loader({
    viem: {
      parseAbi: x => x, parseSignature: () => ({ r: original, s: original, v: 27n }),
      createWalletClient: () => ({ writeContract: async () => { submitted++; return original; } }),
      createPublicClient: () => ({
        waitForTransactionReceipt: async ({ onReplaced }) => {
          onReplaced({ reason: 'cancelled', transaction: { hash: cancellation, from: addr, to: addr, value: 0n, input: '0x' } });
          return { status: 'success', transactionHash: cancellation, logs: [] };
        },
        getTransactionConfirmations: async () => 12n,
      }),
    },
    'viem/accounts': { privateKeyToAccount: () => { throw Error('No private keys used'); } },
    '@/lib/x402Signature': { EVM_CHAIN_IDS: { arbitrum: 42161 } },
    '@/lib/x402Chains': { EVM_CHAINS: { arbitrum: { id: 42161 } }, rpcTransport: () => ({}) },
    '@/lib/kmsAccount': { kmsAccountAvailable: () => true, createKmsAccount: () => ({ address: addr }) },
    '@/lib/flags': { financialEnvironment: () => 'production', flagEnabled: () => true, flagState: () => ({}) },
    '@/lib/log': { log: silentLog },
    '@/lib/x402Assets': { resolveSettlementAsset: () => ({ ok: true, address: token }), settlementGasLimit: () => 200000n,
      parseAtomicAmount: x => /^[0-9]+$/.test(x) ? BigInt(x) : null },
  }, { FACILITATOR_EVM_ADDRESS: addr });
  const { createEvmSettler } = load(path.join(SRC, 'lib/x402Settler.ts'));
  const result = await createEvmSettler()({ paymentRequirements: { network: 'arbitrum', asset: token },
    paymentPayload: { payload: { signature: 'test-signature-parsed-by-stub', authorization: {
      from: addr, to: addr, value: '1000000', validAfter: '0', validBefore: '9999999999', nonce: original,
    } } } }, addr, 12);
  assert.equal(submitted, 1);
  assert.equal(result.transaction, cancellation);
  assert.equal(result.confirmations, 12);
  console.log('CONFIRMED x402: actual settler reports successful settlement of a cancellation receipt with zero transfer logs.');
}

async function bookingProof() {
  const calls = [];
  const trips = [];
  class ResponseStub { static json(data, opts = {}) { return { status: opts.status || 200, data }; } }
  const load = loader({
    'next/server': { NextResponse: ResponseStub },
    '@/lib/travel/propertySource': { findPropertyById: () => null },
    '@/lib/rateLimit': { rateLimitOr429: async () => null },
    '@/lib/travel/store': { addTrip: trip => { trips.push(trip); return trip; } },
    '@/lib/travel/cnft': { mintTicketCnft: async () => ({ network: 'mock' }) },
    '@/lib/travel/entryRequirements': { entryRequirements: () => null },
    '@/lib/log': { log: silentLog },
    '@/lib/locks': { acquireLock: async () => 'test-lock', releaseLock: async () => {} },
    '@/lib/kv': { kvGet: async () => null, kvSet: async () => {} },
    '@/lib/email': { sendEmail: async () => { throw Error('No messages sent'); } },
    '@/lib/emailTemplates': { bookingConfirmationEmail: () => '' },
    '@/lib/authz': { optionalUser: async () => ({ kind: 'anonymous' }) },
  }, { NODE_ENV: 'production', FURLPAY_ENV: 'production', DUFFEL_API_KEY: 'duffel_live_AUDIT_FAKE_NOT_A_CREDENTIAL' }, {
    fetch: async (url, opts) => {
      calls.push({ endpoint: new URL(url).pathname, body: JSON.parse(opts.body) });
      if (url.endsWith('/stays/quotes')) return { ok: true, json: async () => ({ data: { id: 'audit-quote', total_amount: '100', total_currency: 'USD' } }) };
      if (url.endsWith('/stays/bookings')) return { ok: true, json: async () => ({ data: { id: 'audit-booking', reference: 'AUDIT', status: 'confirmed' } }) };
      throw Error('Unexpected external call blocked');
    },
  });
  const { POST } = load(path.join(SRC, 'app/api/travel/book/route.ts'));
  const result = await POST({ json: async () => ({ rateId: 'audit-valid-rate', amountUsd: 100 }) });
  assert.equal(result.status, 200);
  assert.deepEqual(calls.map(c => c.endpoint), ['/stays/quotes', '/stays/bookings']);
  assert.equal(result.data.booking.duffelBookingId, 'audit-booking');
  assert.equal(result.data.booking.authorization.simulated, true);
  assert.equal(trips[0].status, 'confirmed');
  assert.match(trips[0].userId, /^anon:/);
  console.log('CONFIRMED travel: anonymous request without proof/payment reaches actual Duffel booking adapter in production configuration; trip confirmed with simulated authorization.');
  console.log(JSON.stringify({ endpoints: calls.map(c => c.endpoint), status: result.status,
    bookingStatus: result.data.booking.status, simulated: result.data.booking.authorization.simulated,
    tripStatus: trips[0].status, txHashLength: trips[0].txHash.length }));
}

(async () => { await replacementProof(); await bookingProof(); })().catch(e => { console.error(e); process.exitCode = 1; });
