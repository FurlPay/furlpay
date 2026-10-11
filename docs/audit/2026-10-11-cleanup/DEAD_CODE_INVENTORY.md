# Dead-code inventory — apps/web (11 October 2026)

Method: a reachability pass over `apps/web/src`. Roots are every file under
`src/app` (Next.js filesystem routing: pages, layouts, route handlers),
`middleware.ts`, `instrumentation.ts` and the app's scripts and configs.
Edges are static imports, re-exports, dynamic `import()` and `require()`, with
`@/` and relative paths resolved. A file is **unreachable** when neither
production code nor any test reaches it, and **test-only** when only tests do.

Static analysis cannot see a file loaded by a computed path. None of the files
below is referenced by name in `vercel.json`, a workflow, a script or another
package; that was checked separately for each file that was removed.

Scope: `apps/web/src` only. Packages, SDKs, the native apps and the extension
were not analysed for unreachable files.

| | Before | After |
|---|---:|---:|
| Source files (non-test) | 1,779 | 1,773 |
| Unreachable | 34 | 28 |
| Reachable only from tests | 31 | 31 |

## Removed (6 files, 953 lines) — commit `82990e4a`

| File | Evidence |
|---|---|
| `components/StripeCryptoCheckout.tsx` | No import and no mention anywhere in the repository. Last changed 2 July. |
| `components/brand/PartnerMark.tsx` | No import and no mention. |
| `components/landing/InfraFlow.tsx` | No import and no mention. |
| `components/marketing/CodePreview.tsx` | No import and no mention. |
| `components/travel/HotelSearchBar.tsx` | No import and no mention (515 lines). |
| `components/marketing/MarketingBar.tsx` | No import. Its only mention was a comment on the trust page saying it was superseded by the landing header. |

## Unreachable, kept (28 files)

Classes: QUARANTINE (may be wanted; unverified), CONSOLIDATE (duplicates a
canonical implementation; callers would need migrating), BLOCKED (waits on a
partner, credential or product decision). None is REMOVE: each records a
payment, chain or security design, and deleting it is a product decision.

| File | Class | Note |
|---|---|---|
| `components/CollectionCard.tsx` | QUARANTINE | Named as the renderer in lib/markets/collections.ts; the markets collection data is live. |
| `components/UTMTracker.tsx` | QUARANTINE | Deliberately unmounted: attribution needs a consented first-party cookie (docs/release/PRODUCTION_READINESS_FINAL.md). |
| `hooks/useFingerprintPay.ts` | QUARANTINE | Biometric payment hook; a test asserts the card page does NOT use it. Removal is a product decision. |
| `lib/analytics/track.ts` | QUARANTINE | Client analytics helper with no caller; same consent dependency as UTMTracker. |
| `lib/apiError.ts` | QUARANTINE | Shared error-shape helper with no caller. |
| `lib/behaviorTracker.ts` | QUARANTINE | Behavioural signal collector with no caller. |
| `lib/cards/rainRewards.ts` | BLOCKED | Card rewards adapter; card issuing cannot be enabled (no issuer). |
| `lib/chains/adapterRegistry.ts` | CONSOLIDATE | Chain adapter layer (7 files) with no caller. Overlaps the readers in lib/onchain and lib/payments/merchant/rpc.ts. |
| `lib/chains/chainAdapter.ts` | CONSOLIDATE | See adapterRegistry.ts. |
| `lib/chains/chainReconciliation.ts` | CONSOLIDATE | See adapterRegistry.ts. |
| `lib/chains/evmAdapter.ts` | CONSOLIDATE | See adapterRegistry.ts. |
| `lib/chains/nonceManager.ts` | CONSOLIDATE | See adapterRegistry.ts. |
| `lib/chains/solanaAdapter.ts` | CONSOLIDATE | See adapterRegistry.ts. |
| `lib/chains/txSimulation.ts` | CONSOLIDATE | See adapterRegistry.ts. |
| `lib/compliance/index.ts` | QUARANTINE | Barrel file nothing imports; callers import the modules directly. |
| `lib/disputes/escrow.ts` | BLOCKED | Dispute escrow design; no dispute flow is wired. |
| `lib/ecommerce/pluginTypes.ts` | QUARANTINE | Types for the commerce plugins, which live outside this app. |
| `lib/integrity/blockaid.ts` | BLOCKED | Transaction-simulation vendor adapter; needs FURLPAY_TX_SIMULATION_* credentials. |
| `lib/ops/disasterRecovery.ts` | QUARANTINE | Disaster-recovery helpers with no caller. |
| `lib/paymentStateMachine.ts` | QUARANTINE | Payment state machine not used by lib/services/payments.ts, which keeps its own status transitions. |
| `lib/payouts/discord/dm.ts` | QUARANTINE | Discord payout notification with no caller. |
| `lib/providers/providerMatrix.ts` | CONSOLIDATE | Superseded by lib/providers/capability.ts, which the router reads. |
| `lib/rails/india/types.ts` | BLOCKED | Interface for an Indian banking rail; no partner is contracted (BANKING_LIVE). |
| `lib/rails/singapore/straitsx.ts` | BLOCKED | StraitsX rail; no partner contract. |
| `lib/rails/types.ts` | BLOCKED | Shared rail interface for the two files above. |
| `lib/ramp/index.ts` | QUARANTINE | Barrel file nothing imports. |
| `lib/security/accountFreeze.ts` | QUARANTINE | Account-freeze helper with no caller; account locking goes through /api/security/lock and the profile route. |
| `lib/services/chainBalance.ts` | CONSOLIDATE | Balance reader superseded by lib/onchain/balances.ts. |

## Reachable only from tests (31 files)

These have tests but no production caller. A tested module with no caller is
usually a library waiting for its integration, so all are KEEP unless noted.

| File |
|---|
| `lib/agent/decayingAllowance.ts` |
| `lib/agent/policy.ts` |
| `lib/brokerage/events.ts` |
| `lib/cards/rainNetwork.ts` |
| `lib/clientVersion.ts` |
| `lib/compliance/retentionPolicy.ts` |
| `lib/hotels/headingReplay.ts` |
| `lib/hotels/headingTrace.ts` |
| `lib/hotels/hotelSearch.ts` |
| `lib/markets/indicators.ts` |
| `lib/markets/positionSizing.ts` |
| `lib/markets/quant/backtest.ts` |
| `lib/markets/quant/features.ts` |
| `lib/markets/quant/goldSeries.ts` |
| `lib/markets/quant/macroExperiment.ts` |
| `lib/markets/quant/stats.ts` |
| `lib/money/netting.ts` |
| `lib/oracle/index.ts` |
| `lib/passes/content.ts` |
| `lib/payments/privacy.ts` |
| `lib/places/collections.ts` |
| `lib/providers/adapters/furlpayout-offramp.ts` |
| `lib/rails/singapore/sgqr.ts` |
| `lib/security/routeManifestValidator.ts` |
| `lib/travel/tripadvisor/client.ts` |
| `lib/travel/tripadvisor/normalize.ts` |
| `lib/travel/tripadvisor/types.ts` |
| `lib/treasury/register.ts` |
| `lib/trust/graph.ts` |
| `lib/trust/verification.ts` |
| `lib/wallet/session.ts` |

Notable: `lib/providers/adapters/furlpayout-offramp.ts` (the Echo Money adapter)
is test-only by design. Its API and webhook scheme are unverified, so it is
never registered with the provider router.
