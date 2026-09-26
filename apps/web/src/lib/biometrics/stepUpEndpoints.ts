// ---------------------------------------------------------------------------
// The endpoints an action-bound step-up proof can be minted for.
//
// Mirrors the iOS Guardian action registry
// (ios/FurlPayGuardian/Shared/Security/ActionRegistry.swift), which is the only
// thing that can produce a dispatchable action — its `ApprovedAction` initialiser
// is fileprivate, so an unvalidated model proposal cannot reach the network.
//
// Kept as a named constant rather than inlined into the route's Zod enum so the
// list has one home and the route, the tests and any future surface all read the
// same one. A hostname or path that drifts between client and server does not
// fail loudly here — it fails as "your approval was for a different request",
// which reads like a bug in the biometric flow rather than a typo.
// ---------------------------------------------------------------------------

/**
 * `as const` so this is a tuple of literals, which `z.enum` requires and which
 * makes `StepUpEndpoint` a union of the actual strings rather than `string`.
 */
export const STEP_UP_ENDPOINTS = [
  "/payments/create",
  "/swaps",
  "/investing/order",
  "/investing/schedule",
  "/earn/deposit",
  "/cards/settings",
  "/support/tickets",
] as const;

export type StepUpEndpoint = (typeof STEP_UP_ENDPOINTS)[number];
