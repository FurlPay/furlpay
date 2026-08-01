// ---------------------------------------------------------------------------
// @furlpay/transaction-guard
//
// Refuse malformed, stale, or wrong-chain transactions before a key ever
// touches them. Zero runtime dependencies.
// ---------------------------------------------------------------------------

export { GuardRejection, isGuardRejection, type RejectionReason } from "./rejection.js";

export {
  isAddress,
  isNonZeroAddress,
  toChecksumAddress,
  sameAddress,
} from "./address.js";

export {
  isHexData,
  hasCalldata,
  isQuantity,
  selectorOf,
  parseAtomic,
  parseQuantity,
} from "./calldata.js";

export {
  isChainId,
  isBoundToChain,
  confirmationsFor,
  SUGGESTED_CONFIRMATIONS,
} from "./chain.js";

export {
  isFresh,
  isExpiringSoon,
  timeUntilExpiry,
  assertFresh,
  type Expirable,
} from "./quote.js";

export {
  assertSignable,
  assertFeesSane,
  maximumCostWei,
  type TransactionRequest,
  type TransactionPlan,
  type FeeFields,
  type GuardOptions,
} from "./transaction.js";

export {
  ActionRegistry,
  type ActionSpec,
  type FieldSpec,
  type FieldType,
  type Proposal,
  type ResolvedAction,
  type ConfirmationDetail,
  type RegistryOptions,
} from "./registry.js";

// Exported because EIP-55 needs it and the package refuses to take a
// dependency for one hash. Useful on its own if you are already avoiding one.
export { keccak256 } from "./keccak.js";
