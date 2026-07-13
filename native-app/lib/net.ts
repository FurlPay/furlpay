import { useEffect, useState } from "react";
import NetInfo from "@react-native-community/netinfo";

/**
 * Single source of truth for connectivity.
 *
 * Reads exactly like OfflineBanner's own check (`isConnected === false`), so a
 * screen that disables a control and the banner that explains why can never
 * disagree.
 */
export function useIsOffline(): boolean {
  const [offline, setOffline] = useState(false);
  useEffect(() => {
    const unsub = NetInfo.addEventListener((s) => setOffline(s.isConnected === false));
    return unsub;
  }, []);
  return offline;
}

/**
 * Copy for a mutation that cannot be performed offline.
 *
 * Deliberately NOT queued to the outbox. A transfer is safe to queue — the user
 * is told "queued", and the money moves later. A card freeze is not: it's a
 * security control, and a queued freeze would show the card as frozen while it
 * is still live and spendable. Failing loudly is the honest outcome.
 */
export const OFFLINE_MUTATION_MESSAGE =
  "You're offline — this needs a connection. Nothing was changed.";
