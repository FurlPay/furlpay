"use client";

// EIP-6963 Multi-Injected Provider Discovery — dapp-side consumer.
// Replaces the legacy window.ethereum race (last extension to inject wins)
// with an event handshake: the page dispatches eip6963:requestProvider and
// every installed wallet answers with eip6963:announceProvider. The FurlPay
// extension announces itself the same way, so it appears here alongside
// MetaMask, Coinbase Wallet, etc.
//
// ── IDENTITY POLICY (this is a security decision, not a dedupe detail) ─────
//
// EIP-6963 provider metadata is NOT AUTHENTICATED. Nothing stops an extension
// announcing `rdns: "io.metamask"` with MetaMask's name and icon. The previous
// implementation deduped by rdns:
//
//     providers.filter(p => p.info.rdns !== detail.info.rdns)
//
// which made the LAST announcer win — so a colliding extension silently
// replaced the real MetaMask entry in the picker, and the user had no way to
// see it had happened.
//
// The policy now:
//
//   * `uuid` is the identity. The spec requires it to be unique per provider
//     per page session, so a re-announcement from the same provider is the
//     only thing that is safely a duplicate.
//   * FIRST ANNOUNCEMENT WINS per uuid. A second announcement for a uuid we
//     already hold is ignored, so nothing already shown can be swapped out
//     from underneath the user.
//   * A colliding rdns does NOT replace anything. Both providers are kept and
//     the rdns is recorded in `collisions`, so the UI can disambiguate them
//     instead of quietly picking one.
//
// What this does NOT do is tell you which one is genuine. EIP-6963 gives no
// authenticity guarantee and this module does not invent one — it surfaces the
// ambiguity rather than resolving it silently.
//
// ── SNAPSHOT PURITY ────────────────────────────────────────────────────────
//
// `getProviders` used to call `start()`, which dispatches a window event.
// React calls the snapshot getter during render, so discovery was a side
// effect of rendering. Initialization now happens in `subscribe` only, and the
// snapshot returns a cached array whose reference changes only when the
// provider set actually changes — which is also what keeps useSyncExternalStore
// from looping.

import { useSyncExternalStore } from "react";
import { walletEvent } from "./telemetry";

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | Record<string, unknown> }): Promise<unknown>;
  on?(event: string, listener: (payload: unknown) => void): void;
  removeListener?(event: string, listener: (payload: unknown) => void): void;
}

export interface EIP6963ProviderInfo {
  uuid: string; // unique per wallet per browser session
  name: string; // human-readable ("MetaMask", "FurlPay")
  icon: string; // data URI per spec
  rdns: string; // reverse-DNS identifier ("com.furlpay.app")
}

export interface EIP6963ProviderDetail {
  info: EIP6963ProviderInfo;
  provider: Eip1193Provider;
}

class MIPDStore {
  /** Insertion-ordered by uuid. Insertion order IS announcement order. */
  private byUuid = new Map<string, EIP6963ProviderDetail>();
  /** rdns values announced by more than one uuid. */
  private collidingRdns = new Set<string>();
  /** Cached snapshot. Replaced only when the set changes. */
  private snapshot: EIP6963ProviderDetail[] = [];
  private listeners = new Set<() => void>();
  private started = false;

  /**
   * Begin discovery. Called from `subscribe`, never from a snapshot getter.
   * Idempotent — the guard is what keeps one listener and one dispatch.
   */
  private start() {
    if (this.started || typeof window === "undefined") return;
    this.started = true;

    // The listener is intentionally never removed: this is a module singleton
    // that lives for the page session, and a wallet may announce at any time
    // (an extension can be enabled after load). Removing it would silently
    // stop discovering late arrivals.
    window.addEventListener("eip6963:announceProvider", ((
      event: CustomEvent<EIP6963ProviderDetail>,
    ) => {
      this.onAnnounce(event.detail);
    }) as EventListener);

    window.dispatchEvent(new Event("eip6963:requestProvider"));
  }

  private onAnnounce(detail: EIP6963ProviderDetail | undefined) {
    if (!detail?.info?.uuid || !detail.provider || !detail.info.rdns) return;

    // First announcement wins. A repeat for a uuid we hold is a no-op, so a
    // provider already on screen can never be swapped for another object.
    if (this.byUuid.has(detail.info.uuid)) return;

    // Same rdns, different uuid: keep BOTH and record the collision.
    const collision = [...this.byUuid.values()].find(
      (p) => p.info.rdns === detail.info.rdns,
    );
    if (collision) {
      this.collidingRdns.add(detail.info.rdns);
      walletEvent("wallet_provider_collision", {
        rdns: detail.info.rdns,
        incumbentUuid: collision.info.uuid,
        challengerUuid: detail.info.uuid,
      });
    }

    this.byUuid.set(detail.info.uuid, {
      info: detail.info,
      provider: detail.provider,
    });
    this.snapshot = [...this.byUuid.values()];
    this.notify();
  }

  subscribe = (listener: () => void): (() => void) => {
    this.start();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  /** PURE. No initialization, no dispatch, no mutation. */
  getProviders = (): EIP6963ProviderDetail[] => this.snapshot;

  /** rdns values announced by more than one provider this session. */
  getCollisions = (): ReadonlySet<string> => this.collidingRdns;

  /** True when this provider shares its rdns with another announcer. */
  isContested = (rdns: string): boolean => this.collidingRdns.has(rdns);

  /** Tests only. */
  __reset() {
    this.byUuid.clear();
    this.collidingRdns.clear();
    this.snapshot = [];
    this.listeners.clear();
    this.started = false;
  }

  /** Tests only — inject an announcement without a DOM event. */
  __announce(detail: EIP6963ProviderDetail) {
    this.onAnnounce(detail);
  }

  private notify() {
    this.listeners.forEach((fn) => fn());
  }
}

const EMPTY: EIP6963ProviderDetail[] = [];
export const mipdStore = new MIPDStore();

/** All wallets discovered via EIP-6963, updating live as they announce. */
export function useDiscoveredWallets(): EIP6963ProviderDetail[] {
  return useSyncExternalStore(
    mipdStore.subscribe,
    mipdStore.getProviders,
    () => EMPTY, // SSR snapshot — stable reference, no hydration churn
  );
}

/**
 * Display name that stays unambiguous when two extensions claim one rdns.
 *
 * Returns the plain name in the normal case. Under a collision it appends a
 * short uuid fragment, because showing "MetaMask" twice with no way to tell
 * them apart is how a user picks the wrong one.
 */
export function displayName(detail: EIP6963ProviderDetail): string {
  if (!mipdStore.isContested(detail.info.rdns)) return detail.info.name;
  return `${detail.info.name} — provider ${detail.info.uuid.slice(0, 8)}`;
}
