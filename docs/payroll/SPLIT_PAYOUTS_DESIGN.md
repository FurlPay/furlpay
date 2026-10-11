# Design: splitting a contractor's pay across chains (not built)

Status: proposal for approval. Nothing here is implemented or enabled.

## Problem

A contractor wants, for example, 75% of each payment on Arbitrum and 25% on
Base, possibly to different addresses. Today a contractor has one
`payout_chain` and one `payout_address`, and a batch settles on one chain
through that chain's FurlPayRouter.

## Constraints from the current system

- **Non-custodial.** The employer's wallet signs every line; FurlPay never
  holds payroll funds. A split must therefore be more lines for the employer
  to sign, never FurlPay moving money between chains.
- **One chain per batch.** Each line's EIP-712 domain carries one chain id and
  router, so a split produces one batch per chain.
- **Address ownership.** Today's single address can be proved by the
  contractor's own signature (`address_verified_at`). Every additional address
  must be proved the same way before it can receive pay; an employer-entered
  address is never enough.

## Proposal

1. **Allocation record** (new table): `(contractor_id, chain, address, basis_points,
   address_verified_at, proof)`. Basis points sum to exactly 10 000; at most
   four entries; every address must be ownership-proved by the contractor
   (same message format as `lib/payroll/addressMessage.ts`). Only the
   contractor can create or change it, through the self-service route; the
   employer can see but not edit it.
2. **Exact split.** Line amounts are computed in integer micro-units:
   `floor(amount × bp / 10 000)` for every entry except the largest, which
   takes the remainder, so the parts always sum to the original amount.
3. **Batch creation.** When a batch includes a split contractor, FurlPay
   creates one batch per chain (sharing a `split_group_id`), each screened and
   quoted as now. Fees apply per line, so a split costs more; the employer
   sees that before submitting.
4. **Approval.** The employer submits and signs each chain's batch
   separately; nothing is signed or executed automatically.
5. **Partial failure.** If one chain's batch executes and another does not,
   the contractor has been partly paid. The `split_group_id` view shows the
   group as `partially executed` with per-chain state, and reconciliation
   (the existing `merchant-reconcile` job) raises an alert after a day. No
   automatic retry or compensation.
6. **Reconciliation.** Analytics sums paid lines per contractor across chains,
   so totals stay correct; per-chain breakdowns already exist.

## Decisions needed before building

- Is splitting offered at all, given per-line fees and multiple signatures?
- Which chains may be combined (all four router chains, or a subset)?
- Whether an employer may cap or disable splitting for their roster.
