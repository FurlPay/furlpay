"use client";

import { useSyncExternalStore } from "react";
import type { Eip1193Provider, EIP6963ProviderDetail } from "./mipd";
import { addr, walletEvent } from "./telemetry";

// ---------------------------------------------------------------------------
// The wallet session — one place that knows what the provider is currently
// doing, so every consumer sees the same state.
//
// ── THE BUG THIS FIXES ─────────────────────────────────────────────────────
//
// There were no `accountsChanged` / `chainChanged` / `disconnect` listeners
// anywhere in the app. A user could switch account in MetaMask and FurlPay
// would go on displaying the old one indefinitely. Nothing corrected it,
// because nothing was listening.
//
// Listeners live here rather than in a component so they are attached exactly
// once per connected provider and torn down deterministically. A listener in a
// component is attached per mount, which is how you end up with four of them.
//
// ── WHAT A PROVIDER EVENT MAY AND MAY NOT DO ───────────────────────────────
//
// It updates what we DISPLAY. It never authorizes anything.
//
// If the user linked address A and then switches their wallet to address B,
// those stay separate facts: `activeAccount` becomes B, the linked record is
// untouched, and a `notice` is raised so the UI can say so out loud. B is not
// linked, not authorized, and not silently substituted for A anywhere.
//
// Likewise a provider `disconnect` ends the SESSION. It does not unlink the
// wallet — unlinking is an explicit account operation with its own endpoint.
// Conflating the two would let a browser extension crash delete a user's
// account association.
// ---------------------------------------------------------------------------

export type SessionStatus = "idle" | "connecting" | "connected" | "disconnected";

export type SessionNotice =
  | { kind: "account_changed"; from?: string; to?: string }
  | { kind: "account_disconnected" }
  | { kind: "chain_changed"; from?: number; to?: number }
  | { kind: "provider_disconnected"; reason?: string };

export interface WalletSession {
  status: SessionStatus;
  uuid?: string;
  rdns?: string;
  name?: string;
  /**
   * The account the PROVIDER currently reports. Not an authorization, and not
   * necessarily the linked address.
   */
  activeAccount?: string;
  chainId?: number;
  /**
   * Something changed under us and the user has not acknowledged it. The UI
   * shows this; it is never consumed as permission.
   */
  notice?: SessionNotice;
}

const IDLE: WalletSession = { status: "idle" };

type Listener = () => void;

interface Bound {
  provider: Eip1193Provider;
  onAccounts: (payload: unknown) => void;
  onChain: (payload: unknown) => void;
  onDisconnect: (payload: unknown) => void;
}

class SessionStore {
  private state: WalletSession = IDLE;
  private listeners = new Set<Listener>();
  private bound: Bound | null = null;

  subscribe = (l: Listener): (() => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  /** PURE — returns the cached object; reference changes only on real change. */
  get = (): WalletSession => this.state;

  private set(next: WalletSession) {
    this.state = next;
    this.listeners.forEach((fn) => fn());
  }

  /** Mark a connection attempt in flight, so the UI can disable the button. */
  beginConnect(detail: EIP6963ProviderDetail) {
    this.set({
      status: "connecting",
      uuid: detail.info.uuid,
      rdns: detail.info.rdns,
      name: detail.info.name,
    });
  }

  /**
   * Adopt a successful connection and attach provider listeners.
   *
   * Any previously bound provider is detached first. Without that, connecting
   * a second wallet would leave the first one's listeners firing into a
   * session that no longer describes it.
   */
  connected(detail: EIP6963ProviderDetail, account: string, chainId: number) {
    this.detach();

    this.set({
      status: "connected",
      uuid: detail.info.uuid,
      rdns: detail.info.rdns,
      name: detail.info.name,
      activeAccount: account,
      chainId,
    });

    this.attach(detail.provider);
  }

  private attach(provider: Eip1193Provider) {
    if (typeof provider.on !== "function") return;

    const onAccounts = (payload: unknown) => {
      const accounts = Array.isArray(payload) ? (payload as string[]) : [];
      const next = accounts[0];
      const previous = this.state.activeAccount;

      if (!next) {
        // An empty array means the wallet revoked this origin's access to
        // every account. The session is over; the LINK is not touched.
        walletEvent("wallet_disconnected", {
          uuid: this.state.uuid,
          rdns: this.state.rdns,
          reason: "accounts_empty",
        });
        this.set({
          ...this.state,
          status: "disconnected",
          activeAccount: undefined,
          notice: { kind: "account_disconnected" },
        });
        this.detach();
        return;
      }

      if (previous && next.toLowerCase() === previous.toLowerCase()) return;

      walletEvent("wallet_account_changed", {
        uuid: this.state.uuid,
        rdns: this.state.rdns,
        fromAccount: addr(previous),
        account: addr(next),
      });

      // Displayed, never authorized. The notice is what tells the user.
      this.set({
        ...this.state,
        activeAccount: next,
        notice: { kind: "account_changed", from: previous, to: next },
      });
    };

    const onChain = (payload: unknown) => {
      const parsed =
        typeof payload === "string"
          ? Number.parseInt(payload, 16)
          : typeof payload === "number"
            ? payload
            : Number.NaN;
      const next = Number.isFinite(parsed) ? parsed : undefined;
      const previous = this.state.chainId;
      if (next === undefined || next === previous) return;

      walletEvent("wallet_chain_changed", {
        uuid: this.state.uuid,
        rdns: this.state.rdns,
        fromChainId: previous,
        chainId: next,
      });

      // Chain-derived state is invalidated by the reference change plus the
      // notice. Nothing here decides the app's INTENDED network — a wallet
      // moving to Ethereum does not mean FurlPay now wants Ethereum.
      this.set({
        ...this.state,
        chainId: next,
        notice: { kind: "chain_changed", from: previous, to: next },
      });
    };

    const onDisconnect = (payload: unknown) => {
      const reason = (payload as { message?: string })?.message ? "provider_error" : "disconnect";
      walletEvent("wallet_disconnected", {
        uuid: this.state.uuid,
        rdns: this.state.rdns,
        reason,
      });
      this.set({
        ...this.state,
        status: "disconnected",
        activeAccount: undefined,
        notice: { kind: "provider_disconnected", reason },
      });
      this.detach();
    };

    provider.on("accountsChanged", onAccounts);
    provider.on("chainChanged", onChain);
    provider.on("disconnect", onDisconnect);
    this.bound = { provider, onAccounts, onChain, onDisconnect };
  }

  /** Remove listeners from the currently bound provider. Safe to call twice. */
  private detach() {
    const b = this.bound;
    this.bound = null;
    if (!b || typeof b.provider.removeListener !== "function") return;
    b.provider.removeListener("accountsChanged", b.onAccounts);
    b.provider.removeListener("chainChanged", b.onChain);
    b.provider.removeListener("disconnect", b.onDisconnect);
  }

  /** The user dismissed the notice. Does not change any wallet state. */
  acknowledge() {
    if (!this.state.notice) return;
    const { notice: _drop, ...rest } = this.state;
    void _drop;
    this.set(rest);
  }

  /**
   * End the session locally.
   *
   * EIP-1193 has no way for a dapp to revoke its own permission, so this is
   * housekeeping on our side: stop listening, forget the account. It does NOT
   * unlink the wallet from the FurlPay account.
   */
  endSession(reason = "user_disconnect") {
    this.detach();
    walletEvent("wallet_disconnected", {
      uuid: this.state.uuid,
      rdns: this.state.rdns,
      reason,
    });
    this.set({ status: "disconnected", uuid: this.state.uuid, rdns: this.state.rdns, name: this.state.name });
  }

  /** A connection attempt failed; drop back to a usable state. */
  failed() {
    this.detach();
    this.set({ status: "idle" });
  }

  /** Tests only. */
  __reset() {
    this.detach();
    this.state = IDLE;
    this.listeners.clear();
  }

  /** Tests only — is a provider currently bound? */
  __isBound(): boolean {
    return this.bound !== null;
  }
}

export const sessionStore = new SessionStore();

export function useWalletSession(): WalletSession {
  return useSyncExternalStore(sessionStore.subscribe, sessionStore.get, () => IDLE);
}
