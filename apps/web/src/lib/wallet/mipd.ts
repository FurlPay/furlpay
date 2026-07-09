"use client";

// EIP-6963 Multi-Injected Provider Discovery — dapp-side consumer.
// Replaces the legacy window.ethereum race (last extension to inject wins)
// with an event handshake: the page dispatches eip6963:requestProvider and
// every installed wallet answers with eip6963:announceProvider. The FurlPay
// extension announces itself the same way, so it appears here alongside
// MetaMask, Coinbase Wallet, etc.

import { useSyncExternalStore } from "react";

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
  private providers: EIP6963ProviderDetail[] = [];
  private listeners = new Set<() => void>();
  private started = false;

  /** Lazy — window events only exist client-side, so start on first use. */
  private start() {
    if (this.started || typeof window === "undefined") return;
    this.started = true;

    window.addEventListener("eip6963:announceProvider", ((event: CustomEvent<EIP6963ProviderDetail>) => {
      const detail = event.detail;
      if (!detail?.info?.uuid || !detail.provider) return;
      // Wallets may re-announce (e.g. on requestProvider) — dedupe by uuid,
      // and by rdns so a wallet restarting with a fresh uuid replaces itself.
      if (this.providers.some((p) => p.info.uuid === detail.info.uuid)) return;
      this.providers = [
        ...this.providers.filter((p) => p.info.rdns !== detail.info.rdns),
        { info: detail.info, provider: detail.provider },
      ];
      this.notify();
    }) as EventListener);

    window.dispatchEvent(new Event("eip6963:requestProvider"));
  }

  subscribe = (listener: () => void): (() => void) => {
    this.start();
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getProviders = (): EIP6963ProviderDetail[] => {
    this.start();
    return this.providers;
  };

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
    () => EMPTY // SSR snapshot
  );
}
