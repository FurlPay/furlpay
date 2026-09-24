import { useSyncExternalStore } from "react";
import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";
import { DEVICE_ONLY } from "../storageOptions";
import { api, NetworkError } from "@/lib/api";
import { cacheGet, cacheSet } from "@/lib/db";

// ---------------------------------------------------------------------------
// Client feature flags.
//
// The server registry is apps/web/src/lib/clientFlags/registry.ts and this list
// MUST stay a subset of it — a key that exists only here resolves to its local
// default forever and nobody notices, which is the failure mode a flag system
// is supposed to prevent. `lib/flags/__tests__/flags.test.ts` pins the list.
//
// THREE LAYERS, IN THIS ORDER:
//
//   1. server payload   fetched at launch, cached in SQLite
//   2. cached payload   last good server answer, survives offline launches
//   3. local defaults   compiled into the build
//
// Layer 3 exists because a flag read happens during the first render, before
// any network call can have finished. Returning `undefined` there would force
// every call site to handle a third state, and the honest answer at that moment
// is "the safe default", not "unknown".
//
// EVERY LOCAL DEFAULT IS THE SAFE VALUE, NOT THE DESIRABLE ONE. If the server
// is unreachable the app renders as if the feature does not exist. That is
// correct: the alternative is a screen that talks to an endpoint the deployment
// has switched off, and a user watching a spinner resolve into a 403.
//
// A FLAG IS NOT A PERMISSION. Nothing here is checked instead of an API
// authorisation. Flipping one on a rooted device reveals a screen whose first
// request still fails server-side.
// ---------------------------------------------------------------------------

export const CLIENT_FLAGS = [
  "wallet_connect",
  "nft_gallery",
  "tx_simulation",
  "custom_tokens",
  "asset_discovery",
  "cloud_backup",
  "p2p_marketplace",
  "onramp_ui",
  "offramp_ui",
  "staking_ui",
  "balance_hiding",
  "referrals",
  "stories",
  "promo_banners",
  "surveys",
  "app_rating",
  "prediction_markets",
  "qr_from_gallery",
  "wallet_provisioning",
  "self_custody_send",
] as const;

export type ClientFlag = (typeof CLIENT_FLAGS)[number];

/** Compiled-in fallbacks. See the header: safe, not desirable. */
export const LOCAL_DEFAULTS: Record<ClientFlag, boolean> = {
  wallet_connect: false,
  nft_gallery: false,
  // Only ever adds a pre-signature warning, so the offline answer is "still
  // warn me". Defaulting this off would make the degraded path the unsafe one.
  tx_simulation: true,
  custom_tokens: false,
  asset_discovery: false,
  cloud_backup: false,
  p2p_marketplace: false,
  onramp_ui: false,
  offramp_ui: false,
  staking_ui: false,
  // Purely local presentation — no endpoint behind it, so an offline launch can
  // honour it without risk.
  balance_hiding: true,
  referrals: false,
  stories: false,
  promo_banners: false,
  surveys: false,
  app_rating: false,
  prediction_markets: false,
  qr_from_gallery: false,
  wallet_provisioning: false,
  // OFF is the safe answer twice over: an offline launch must not switch the
  // Send tab onto a rail whose relayer it cannot confirm is live, and the demo
  // rail it falls back to already refuses honestly in production.
  self_custody_send: false,
};

const CACHE_KEY = "client_flags";
const INSTALL_ID_KEY = "furlpay.installId";

export type FlagSource = "defaults" | "cache" | "server";

interface FlagState {
  values: Record<ClientFlag, boolean>;
  source: FlagSource;
  resolvedAt: number;
}

let state: FlagState = { values: { ...LOCAL_DEFAULTS }, source: "defaults", resolvedAt: 0 };

const listeners = new Set<() => void>();

function emit(next: FlagState): void {
  state = next;
  for (const l of listeners) l();
}

/**
 * Keep only keys this build knows about, and only booleans.
 *
 * A server that has been deployed ahead of the app will send flags this binary
 * has never heard of; a server that has been rolled BACK will omit ones it
 * has. Neither may corrupt the map, so unknown keys are dropped and missing
 * ones fall through to the local default rather than becoming `undefined` —
 * which would read as `false` at every call site and silently hide a shipped
 * feature.
 */
export function normalizeFlagPayload(raw: unknown): Record<ClientFlag, boolean> {
  const out = { ...LOCAL_DEFAULTS };
  if (!raw || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;
  for (const key of CLIENT_FLAGS) {
    if (typeof obj[key] === "boolean") out[key] = obj[key] as boolean;
  }
  return out;
}

/**
 * Stable per-install id used as the rollout subject before sign-in.
 *
 * SecureStore rather than SQLite so it survives a cache wipe: a rollout cohort
 * that reshuffles whenever the user clears data is a rollout nobody can measure.
 * randomUUID, never Math.random — AGENTS.md rule 6.
 */
export async function installId(): Promise<string> {
  const existing = await SecureStore.getItemAsync(INSTALL_ID_KEY, DEVICE_ONLY);
  if (existing) return existing;
  const fresh = Crypto.randomUUID();
  await SecureStore.setItemAsync(INSTALL_ID_KEY, fresh, DEVICE_ONLY);
  return fresh;
}

/**
 * Load flags: cache first (synchronously usable), then the network.
 *
 * The cached layer is applied even when the fetch is about to succeed, because
 * the fetch takes a round trip and the first frame renders before it lands.
 * Applying the cache first means a returning user sees their real flag set
 * immediately instead of the compiled defaults flashing for 200ms.
 */
export async function loadFlags(): Promise<FlagState> {
  const cached = cacheGet<Record<string, unknown>>(CACHE_KEY);
  if (cached) {
    emit({ values: normalizeFlagPayload(cached.value), source: "cache", resolvedAt: cached.updatedAt });
  }

  try {
    const id = await installId();
    const res = await api<{ flags: Record<string, unknown> }>(
      `/flags/client?installId=${encodeURIComponent(id)}`,
    );
    const values = normalizeFlagPayload(res.flags);
    cacheSet(CACHE_KEY, res.flags);
    emit({ values, source: "server", resolvedAt: Date.now() });
  } catch (e) {
    // A flag fetch failing is not a user-visible error: the cached or default
    // layer is already a correct answer. It IS worth a breadcrumb, because
    // "everyone is on defaults" and "the endpoint is 500ing" look identical
    // from the outside. Rethrowing here would take down app launch over a
    // cosmetic payload, which is the opposite of what a kill switch is for.
    if (!(e instanceof NetworkError)) {
      const { captureMessage } = await import("@/lib/observability");
      captureMessage("client flag fetch failed", "warning", { error: (e as Error).message });
    }
  }
  return state;
}

/** Imperative read, for code paths outside React. */
export function flagEnabled(flag: ClientFlag): boolean {
  return state.values[flag] ?? LOCAL_DEFAULTS[flag];
}

/** Where the current values came from. Rendered on the debug screen. */
export function flagSource(): FlagSource {
  return state.source;
}

export function flagSnapshot(): Record<ClientFlag, boolean> {
  return state.values;
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/**
 * Subscribe a component to one flag.
 *
 * useSyncExternalStore rather than a Zustand store or context: flags are read
 * during render on almost every screen, and this keeps the read a plain
 * function call with no provider to forget to mount in a test.
 */
export function useFlag(flag: ClientFlag): boolean {
  return useSyncExternalStore(
    subscribe,
    () => state.values[flag] ?? LOCAL_DEFAULTS[flag],
    () => LOCAL_DEFAULTS[flag],
  );
}

/** Test seam. Never called from app code. */
export function __setFlagsForTest(values: Partial<Record<ClientFlag, boolean>>, source: FlagSource = "server"): void {
  emit({ values: { ...LOCAL_DEFAULTS, ...values }, source, resolvedAt: Date.now() });
}

export function __resetFlagsForTest(): void {
  emit({ values: { ...LOCAL_DEFAULTS }, source: "defaults", resolvedAt: 0 });
}
