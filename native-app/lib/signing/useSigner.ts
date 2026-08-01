import { useCallback, useEffect, useMemo, useState } from "react";
import { listSigners } from "./registry";
import {
  isReady,
  nextAction,
  type ConnectionState,
  type DeviceConnection,
} from "./connection";
import type { AccountSigner } from "./types";

// ---------------------------------------------------------------------------
// React bindings for the signing layer.
//
// Thin on purpose. All the behaviour lives in connection.ts as pure state, so
// these hooks only bridge subscription → render. That split is what lets the
// state machine be tested without a renderer, and the renderer be swapped
// without touching the machine.
// ---------------------------------------------------------------------------

/** The connection state of a signer, or a synthetic ready-state if it has none. */
export function useConnection(signer: AccountSigner | null): {
  state: ConnectionState;
  ready: boolean;
  action: string | null;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  connection: DeviceConnection | null;
} {
  const connection = signer?.connection ?? null;

  // A signer with no connection is not "disconnected" — it has nothing to
  // connect. The device key is always available; a Tangem tap is its own
  // session. Reporting `connected` here is what stops a UI from rendering a
  // pointless "Connect" button in front of them.
  const [state, setState] = useState<ConnectionState>(
    () => connection?.state() ?? { phase: "connected", blockers: [] }
  );

  useEffect(() => {
    if (!connection) {
      setState({ phase: "connected", blockers: [] });
      return;
    }
    // subscribe() fires immediately, so this also seeds the initial state and
    // there is no window where the UI shows a stale phase from a prior signer.
    return connection.subscribe(setState);
  }, [connection]);

  const connect = useCallback(async () => {
    if (connection) await connection.connect();
  }, [connection]);

  const disconnect = useCallback(async () => {
    if (connection) await connection.disconnect();
  }, [connection]);

  return {
    state,
    ready: isReady(state),
    action: nextAction(state),
    connect,
    disconnect,
    connection,
  };
}

/**
 * Every signer the app can currently use.
 *
 * Reads the registry rather than a hardcoded vendor list, so this is exactly
 * what is available — never a menu of options that do nothing when tapped. A
 * Ledger appears here the moment its plugin registers and not one moment
 * before.
 */
export function useAvailableSigners(): AccountSigner[] {
  // The registry is populated at startup and does not change during a session,
  // so a snapshot is correct and avoids a subscription for something static.
  return useMemo(() => listSigners(), []);
}
