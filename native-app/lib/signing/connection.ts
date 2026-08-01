// ---------------------------------------------------------------------------
// Device connections.
//
// Hardware wallet failures are overwhelmingly CONNECTION failures, not signing
// failures. The signing call is a few hundred bytes over a link that already
// works; everything hard happens before it — Bluetooth is off, the OS never
// granted the permission, the device is asleep, the wrong app is open, the
// battery died mid-approval, iOS suspended the app and dropped the link.
//
// So this models the link explicitly rather than letting each vendor plugin
// invent its own failure vocabulary.
//
// THREE AXES, NOT ONE. The obvious design is a single status enum —
// disconnected | connecting | connected | locked | needs_confirmation. That
// conflates three independent things and becomes unrepresentable the moment
// reality is slightly awkward, because a device can be simultaneously:
//
//   connected      (transport is up)          ← Phase
//   locked         (PIN not entered)          ← Readiness
//   awaiting a tap (a signature is in flight) ← the operation's business
//
// A single enum forces those into a false sequence and then cannot answer
// "connected but locked", which is the single most common hardware state a user
// is actually in. Phase and Readiness are separate here. The third axis is not
// here at all: an in-flight signature belongs to the signing call, and
// `AccountSigner.signTransaction` already reports it.
//
// NOT EVERY SIGNER HAS A CONNECTION. The on-device key is always available;
// a Tangem card has no persistent link at all (each tap is a fresh session);
// WalletConnect has a relayed session rather than a device. `DeviceConnection`
// is therefore OPTIONAL on a signer — modelling Ledger's BLE lifecycle as if it
// were universal would force three vendors to fake states they do not have.
// ---------------------------------------------------------------------------

/** Where the transport is. Nothing about whether the device is usable. */
export type ConnectionPhase = "disconnected" | "scanning" | "connecting" | "connected";

/**
 * Why a CONNECTED device still cannot sign.
 *
 * Every one of these is actionable by the user, which is the point: the UI can
 * only say "unlock your Ledger" if the layer underneath distinguishes that from
 * "turn Bluetooth on".
 */
export type ReadinessBlocker =
  | "locked" // PIN not entered
  | "wrong-app" // e.g. Bitcoin app open, Ethereum app needed
  | "firmware-outdated"
  | "battery-critical"
  | "unsupported-chain";

export interface ConnectionState {
  phase: ConnectionPhase;
  /** Empty when the device is ready. Ordered most-blocking first. */
  blockers: ReadinessBlocker[];
  /** Present on the device the transport is attached to. */
  deviceLabel?: string;
  /** Why the last attempt ended, when it ended badly. */
  lastError?: ConnectionError;
}

/**
 * A connection failure the UI can act on.
 *
 * The `reason` is the load-bearing part. "Connection failed" is useless copy;
 * "Bluetooth is off" and "we never got Bluetooth permission" send the user to
 * two completely different places, and only one of them is a Settings screen we
 * can deep-link.
 */
export type ConnectionFailure =
  | "bluetooth-off"
  | "bluetooth-unauthorized" // permission denied at the OS level
  | "bluetooth-unsupported" // simulator, or a device with no BLE
  | "nfc-off"
  | "nfc-unsupported"
  | "no-device-found"
  | "pairing-rejected"
  | "link-lost" // was connected, then dropped
  | "timeout"
  | "cancelled" // the user backed out; not an error to shout about
  | "unknown";

export class ConnectionError extends Error {
  readonly reason: ConnectionFailure;
  /** False when retrying cannot possibly help without user action elsewhere. */
  readonly retryable: boolean;

  constructor(reason: ConnectionFailure, message: string, retryable = true) {
    super(message);
    this.name = "ConnectionError";
    this.reason = reason;
    this.retryable = retryable;
  }
}

/**
 * User-facing copy for a failure.
 *
 * Lives here rather than in a screen so every surface says the same thing, and
 * so the wording is testable. Each string names the remedy — a message that
 * only states the problem leaves the user with nowhere to go.
 */
export function describeFailure(reason: ConnectionFailure): string {
  switch (reason) {
    case "bluetooth-off":
      return "Bluetooth is off. Turn it on to connect your wallet.";
    case "bluetooth-unauthorized":
      return "FurlPay needs Bluetooth permission to reach your wallet. You can grant it in Settings.";
    case "bluetooth-unsupported":
      return "This device doesn't support Bluetooth wallets.";
    case "nfc-off":
      return "NFC is off. Turn it on to tap your card.";
    case "nfc-unsupported":
      return "This device doesn't support NFC cards.";
    case "no-device-found":
      return "No wallet found. Make sure it's switched on and nearby.";
    case "pairing-rejected":
      return "Pairing was declined on the device.";
    case "link-lost":
      return "Lost the connection to your wallet. Move it closer and try again.";
    case "timeout":
      return "Your wallet didn't respond in time.";
    case "cancelled":
      return "Cancelled.";
    case "unknown":
      return "Couldn't connect to your wallet.";
  }
}

/** User-facing copy for a readiness blocker, naming what to do about it. */
export function describeBlocker(blocker: ReadinessBlocker, deviceLabel = "your wallet"): string {
  switch (blocker) {
    case "locked":
      return `Unlock ${deviceLabel} to continue.`;
    case "wrong-app":
      return `Open the Ethereum app on ${deviceLabel}.`;
    case "firmware-outdated":
      return `${deviceLabel} needs a firmware update before it can sign this.`;
    case "battery-critical":
      return `${deviceLabel} is nearly out of battery. Charge it before signing.`;
    case "unsupported-chain":
      return `${deviceLabel} can't sign for this network.`;
  }
}

export type ConnectionListener = (state: ConnectionState) => void;

/**
 * A managed link to a physical device.
 *
 * Implemented only by signers that HAVE a link — see the header. `connect` is
 * idempotent: calling it on an already-connected device resolves immediately
 * rather than tearing down and re-establishing, because a UI that calls it
 * defensively on every screen mount is the normal case, not a misuse.
 */
export interface DeviceConnection {
  state(): ConnectionState;

  /**
   * Establishes the link. Rejects with a `ConnectionError`.
   *
   * `signal` matters more than it looks: a BLE scan runs for tens of seconds
   * and the user WILL navigate away mid-scan. Without cancellation that scan
   * keeps the radio busy and eventually resolves into a screen that is gone.
   */
  connect(options?: { signal?: AbortSignal; timeoutMs?: number }): Promise<void>;

  disconnect(): Promise<void>;

  /** Returns an unsubscribe function. */
  subscribe(listener: ConnectionListener): () => void;
}

/** True when the transport is up and nothing is blocking a signature. */
export function isReady(state: ConnectionState): boolean {
  return state.phase === "connected" && state.blockers.length === 0;
}

/**
 * The single most useful thing to tell the user right now, or null if ready.
 *
 * Order is deliberate: transport before readiness, because "unlock your Ledger"
 * is nonsense advice when the app cannot see the Ledger at all. Within
 * readiness, `blockers` is ordered most-blocking-first by the plugin that
 * produced it, so the first one is the one to act on.
 */
export function nextAction(state: ConnectionState): string | null {
  const label = state.deviceLabel ?? "your wallet";

  if (state.phase === "disconnected") {
    // A previous failure is more informative than a generic prompt.
    return state.lastError
      ? describeFailure(state.lastError.reason)
      : `Connect ${label} to continue.`;
  }
  if (state.phase === "scanning") return `Looking for ${label}…`;
  if (state.phase === "connecting") return `Connecting to ${label}…`;

  const blocker = state.blockers[0];
  return blocker ? describeBlocker(blocker, label) : null;
}

/**
 * Base implementation: state storage, subscriber fan-out, idempotent connect.
 *
 * Exists so a vendor plugin implements only the parts that are actually
 * vendor-specific (`establish` / `teardown`) instead of re-deriving listener
 * bookkeeping — which is exactly where a plugin quietly leaks a subscriber and
 * keeps a dead screen updating.
 */
export abstract class BaseDeviceConnection implements DeviceConnection {
  private current: ConnectionState = { phase: "disconnected", blockers: [] };
  private listeners = new Set<ConnectionListener>();
  private inFlight: Promise<void> | null = null;

  state(): ConnectionState {
    return this.current;
  }

  subscribe(listener: ConnectionListener): () => void {
    this.listeners.add(listener);
    // Fires immediately with the current state: a screen that mounts mid-
    // connection must not sit blank until the next transition happens to occur.
    //
    // Guarded like the fan-out below, and for the same reason — an unguarded
    // call here let a listener that throws on its first invocation take down
    // subscribe() itself, so a single broken screen could stop the caller that
    // was merely trying to observe the radio.
    this.deliver(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  protected update(patch: Partial<ConnectionState>): void {
    this.current = { ...this.current, ...patch };
    for (const listener of this.listeners) this.deliver(listener);
  }

  private deliver(listener: ConnectionListener): void {
    try {
      listener(this.current);
    } catch {
      // A throwing subscriber is a broken screen, not a broken radio.
    }
  }

  async connect(options: { signal?: AbortSignal; timeoutMs?: number } = {}): Promise<void> {
    if (this.current.phase === "connected") return;
    // Coalesced: two screens both calling connect() must not start two scans
    // competing for the same radio.
    if (this.inFlight) return this.inFlight;

    this.update({ phase: "connecting", lastError: undefined });
    this.inFlight = this.establish(options)
      .then(() => {
        this.update({ phase: "connected" });
      })
      .catch((e: unknown) => {
        const error =
          e instanceof ConnectionError
            ? e
            : new ConnectionError("unknown", describeFailure("unknown"));
        this.update({ phase: "disconnected", lastError: error });
        throw error;
      })
      .finally(() => {
        this.inFlight = null;
      });

    return this.inFlight;
  }

  async disconnect(): Promise<void> {
    try {
      await this.teardown();
    } finally {
      // Disconnected regardless: a teardown that failed still leaves us without
      // a usable link, and reporting "connected" would strand the UI.
      this.update({ phase: "disconnected", blockers: [] });
    }
  }

  /** Called when the link drops on its own — cable pulled, device slept. */
  protected onLinkLost(): void {
    this.update({
      phase: "disconnected",
      blockers: [],
      lastError: new ConnectionError("link-lost", describeFailure("link-lost")),
    });
  }

  protected abstract establish(options: { signal?: AbortSignal; timeoutMs?: number }): Promise<void>;
  protected abstract teardown(): Promise<void>;
}
