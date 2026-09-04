// ---------------------------------------------------------------------------
// @furlpay/payment-intent — the durable record of one payment attempt.
//
// The connective tissue between four packages that already existed and had
// never been joined: @furlpay/gateway decides whether a payment is valid,
// @furlpay/agent-trust decides whether the agent may spend it,
// @furlpay/solana-rpc reports what the chain actually did, and
// @furlpay/ledger records the money.
//
// A PaymentIntent is the row that survives a crash and lets a retry discover
// which of those already happened. Without it the only answers to "the HTTP
// response was lost — has this been paid?" are to sign another payment (a
// double charge) or to refuse (a lost sale).
//
// TWO RULES CARRY THE DESIGN:
//
//   UNKNOWN IS A STATE, NOT AN ERROR. An RPC timeout says nothing about the
//   chain. PAYMENT_UNKNOWN is distinct from PAYMENT_FAILED and from SETTLED,
//   it cannot jump to either without observation, and it is the only state
//   with edges that resolve in both directions.
//
//   ANYTHING THAT MIGHT HAVE TOUCHED THE CHAIN RECONCILES. `recoveryFor`
//   returns `reconcile` for every state where a signature may exist —
//   including PAYMENT_UNKNOWN and even a stored PAYMENT_FAILED, because that
//   verdict was written by a process that then crashed.
//
// Money is a decimal string of integer atomic units, never a number: beyond
// 2^53 a JavaScript number silently stops being exact, which USDC reaches at
// about 9 billion units. Arithmetic goes through BigInt.
//
// Zero dependencies. Node 20+ and Edge compatible.
// ---------------------------------------------------------------------------

export {
  IntentTransitionError,
  canTransition,
  createIntent,
  holdsReservation,
  isAtomicAmount,
  isExpired,
  isKeyReuse,
  isTerminal,
  legalNext,
  matches,
  mayHaveTouchedChain,
  needsRelease,
  recoveryFor,
  sumAtomic,
  transition,
  type CreateIntentInput,
  type IntentState,
  type PaymentIntent,
  type RecoveryAction,
  type TransitionPatch,
} from "./src/intent.js";
