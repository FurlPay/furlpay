# @furlpay/transaction-guard

**Refuse malformed, stale, or wrong-chain transactions before a key ever touches them.**

Zero runtime dependencies. Works in Node, browsers, and React Native.

```bash
npm install @furlpay/transaction-guard
```

---

## The problem

A wallet builds a transaction from data it did not create — an aggregator quote, a backend response, a dApp request, an LLM suggestion. By the time a signature exists, it is too late to check any of it: a signed transaction is valid, broadcastable, and irreversible.

Four failures cause most of the damage, and none of them are caught downstream:

**Chain mismatch.** The same address exists on every EVM chain. A transaction built for chain A but signed while the user believes they're on chain B isn't rejected anywhere — it's a *valid* transaction on A, spendable against whatever balance they hold there. The signature is correct. The address is correct. Nothing complains.

**Stale quotes.** Aggregator calldata is priced at build time and embeds a minimum-received floor the router enforces on-chain. Signing it five minutes later asks that router to honour a market that has moved. Many quote APIs return no expiry at all, so wallets reading only what the aggregator sends have no freshness guarantee and usually don't know it.

**Malformed fields.** An address that isn't 20 bytes, calldata with odd length, an amount that `BigInt()` throws on. Each becomes a signature over nonsense, or an exception in the middle of a signing flow.

**Unbounded AI proposals.** An LLM may *propose* an action. If your integration takes `{ endpoint, method, body }` from the model and calls it, that's a remote code execution primitive wearing a JSON hat.

This library refuses all four, before signing.

---

## Quick start

```ts
import { assertSignable, isGuardRejection } from "@furlpay/transaction-guard";

try {
  assertSignable(plan, 42161); // the chain the USER chose
} catch (error) {
  if (isGuardRejection(error)) {
    showToUser(error.message);   // "That quote expired. Get a fresh price…"
    logToTelemetry(error.reason); // "expired" — stable, machine-readable
    return;
  }
  throw error;
}

const signature = await wallet.sign(plan.transactionRequest);
```

`reason` and `message` are deliberately separate: a UI needs a sentence, telemetry needs a stable key, and deriving either from the other produces log lines that change when copy is edited.

---

## What it checks

### Addresses — EIP-55, correctly

```ts
import { isAddress, isNonZeroAddress, toChecksumAddress } from "@furlpay/transaction-guard";

isAddress("0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"); // true  — checksum verifies
isAddress("0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed"); // true  — lowercase claims no checksum
isAddress("0x5AAeb6053F3E94C9b9A09f33669435E7Ef1BeAed"); // false — mixed case, wrong checksum

isNonZeroAddress("0x0000000000000000000000000000000000000000"); // false
```

The case rule is the whole thing, and it's easy to get backwards. Per [ERC-55](https://eips.ethereum.org/EIPS/eip-55), an all-lowercase or all-uppercase address carries **no checksum** and is valid — lowercase is what plenty of explorers and RPC responses emit. Only a **mixed-case** address claims a checksum, and only then must it verify.

Enforce checksums unconditionally and you reject addresses your users legitimately pasted. Accept any mixed case and you silently discard the ~99.986% typo detection the standard exists to provide.

### Chain binding

```ts
import { isBoundToChain, confirmationsFor } from "@furlpay/transaction-guard";

isBoundToChain(tx.chainId, expectedChainId); // both required, no defaults
confirmationsFor(1);     // 3 — mainnet reorgs of a block or two are routine
confirmationsFor(8453);  // 1 — single-sequencer rollup
```

No built-in network registry. A library that ships its own chain table goes stale the first time you add an L2, and then needs republishing for someone else's roadmap. You know which chain the user picked; that's the only source that can be right.

### Quote freshness

```ts
import { assertFresh, isExpiringSoon } from "@furlpay/transaction-guard";

assertFresh(quote);                  // throws "no_expiry" or "expired"
isExpiringSoon(quote, 15_000);       // true → re-quote instead of showing it
```

A **missing** expiry is treated as stale, not eternal. The absence of a freshness guarantee is not a freshness guarantee, and the opposite default means signing an hours-old price.

### Calldata and quantities

```ts
import { hasCalldata, parseAtomic, parseQuantity, selectorOf } from "@furlpay/transaction-guard";

hasCalldata("0x");           // false — a contract call needs data
parseAtomic("1e6");          // null  — never throws, unlike BigInt()
parseQuantity("0xffffffffffffffffff"); // 4722366482869645213695n — no rounding
selectorOf(data);            // "0x095ea7b3"
```

`parseQuantity` returns a `bigint` because gas and wei routinely exceed 2^53, where `Number` silently rounds — and a rounded value moves a different amount than the one quoted.

### AI-proposed actions

```ts
import { ActionRegistry } from "@furlpay/transaction-guard";

const registry = new ActionRegistry([
  {
    id: "send_payment",
    title: "Send payment",
    endpoint: "/payments/create",
    fields: {
      amount:    { type: "number", label: "Amount", currency: true, min: 0.01, max: 25_000 },
      recipient: { type: "string", label: "To", pattern: /^0x[0-9a-fA-F]{40}$/ },
      chain:     { type: "string", label: "Chain", oneOf: ["arbitrum", "base"] },
    },
  },
], { maxAmount: 25_000 });

// Whatever the model sent, the request is REBUILT from the registry.
const action = registry.resolve(proposal);
await api(action.endpoint, { method: action.method, body: action.body });
```

- A field that isn't declared is **dropped** — it never reaches the wire
- A field whose type, range, pattern or enum disagrees **rejects the whole action**
- An endpoint or method that disagrees **rejects the action**
- `constants` are set by the registry and **cannot be overridden** — use them for discriminators that decide whether money moves
- Rejection happens **before** any confirmation UI, so a user is never asked to approve something already destined to fail

The action id selects the spec. The proposed endpoint never does — inferring one from the other lets a crafted endpoint pick its own validator.

---

## Why zero dependencies

EIP-55 needs keccak-256, and this package implements it rather than importing one. That isn't hand-rolled cryptography in the dangerous sense: there's no key, no nonce, no secret input — every byte hashed is a public address the attacker already knows. The only property that matters is functional correctness, and correctness of a hash is settled by test vectors, not by trust.

`test/keccak.test.js` pins the published digests for `""`, `"abc"` and `"testing"`, plus the four canonical EIP-55 addresses from the ERC. During development those vectors caught a real bug — a rotation table indexed by lane instead of by loop iteration, which permutes plausibly and hashes wrongly. A snapshot of our own output would have locked it in.

`keccak256` is exported, in case you're avoiding a dependency too.

---

## Why this exists

We ran this registry on three platforms — TypeScript, Kotlin and Swift — and they drifted.

The Swift copy ended up with different field names, a **4× higher spending ceiling**, and no pattern constraints at all, so an AI-proposed payment could carry any string as its recipient. Everything compiled. Every test passed. Each platform was testing its own copy against itself.

One implementation, imported everywhere, is the actual fix. That's this package.

---

## API

| Export | Purpose |
|---|---|
| `assertSignable(plan, chainId, opts?)` | Everything below, composed |
| `assertFeesSane(fees)` | EIP-1559 caps are internally consistent |
| `maximumCostWei(fees)` | Worst-case cost, for a balance check that can't pass optimistically |
| `isAddress` · `isNonZeroAddress` · `toChecksumAddress` · `sameAddress` | EIP-55 |
| `isBoundToChain` · `isChainId` · `confirmationsFor` | Chain binding |
| `assertFresh` · `isFresh` · `isExpiringSoon` · `timeUntilExpiry` | Quote freshness |
| `isHexData` · `hasCalldata` · `isQuantity` · `selectorOf` · `parseAtomic` · `parseQuantity` | Field shapes |
| `ActionRegistry` | AI-proposed action allowlist |
| `GuardRejection` · `isGuardRejection` · `RejectionReason` | Typed refusals |
| `keccak256` | The hash, since we had to implement it |

Every `assert*` throws `GuardRejection`; every `is*` returns a boolean and never throws.

---

## Testing

```bash
npm test   # builds, then runs 46 tests on node:test
```

---

## License

MIT
