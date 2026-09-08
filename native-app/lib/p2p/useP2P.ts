import { useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchAd, fetchAds, fetchConfig, fetchOrder, fetchOrders, heartbeat, type AdFilter } from "./api";
import { isOrderLive } from "./types";
import type { P2POrder } from "./types";

// ---------------------------------------------------------------------------
// React Query bindings for the marketplace.
//
// POLLING IS SCOPED TO WHAT CAN ACTUALLY CHANGE, which is the only interesting
// decision here. A P2P order is a conversation with a human on the other end:
// the buyer pays, the seller confirms, and minutes pass between the two. The
// screen has to notice those transitions without a push, so it polls — but:
//
//   - a SETTLED order (released / cancelled) never changes again, so polling it
//     is battery spent on a question with a known answer. `isOrderLive` gates it.
//   - the ad BOOK moves constantly and matters much less; a stale price is
//     caught at quote time by the server, so it refetches lazily.
//
// The two intervals differ by an order of magnitude for that reason, rather
// than sharing one "refresh" constant that would be wrong for both.
// ---------------------------------------------------------------------------

/** A live order's next state depends on a person, not a block. 10s is
 *  responsive without being a poll storm across a long payment window. */
const LIVE_ORDER_POLL_MS = 10_000;

/** The book. Stale prices are caught server-side at quote time. */
const ADS_STALE_MS = 30_000;

export function useP2PConfig() {
  return useQuery({
    queryKey: ["p2p", "config"],
    queryFn: fetchConfig,
    // The corridor list changes on deploys, not during a session.
    staleTime: 10 * 60_000,
  });
}

export function useAds(filter: AdFilter) {
  return useQuery({
    queryKey: ["p2p", "ads", filter],
    queryFn: () => fetchAds(filter),
    staleTime: ADS_STALE_MS,
  });
}

export function useAd(id: string | undefined) {
  return useQuery({
    queryKey: ["p2p", "ad", id],
    queryFn: () => fetchAd(id!),
    enabled: Boolean(id),
    staleTime: ADS_STALE_MS,
  });
}

export function useOrders(status?: string) {
  return useQuery({
    queryKey: ["p2p", "orders", status ?? "all"],
    queryFn: () => fetchOrders(status),
    // The list is a summary; the detail screen is where a live order is
    // watched closely. Polling both at 10s would double the traffic for one
    // user watching one order.
    refetchInterval: 30_000,
  });
}

export function useOrder(id: string | undefined) {
  return useQuery({
    queryKey: ["p2p", "order", id],
    queryFn: () => fetchOrder(id!),
    enabled: Boolean(id),
    // The gate described in the header: poll only while the order can still
    // move. `query.state.data` is read rather than a captured variable so the
    // interval stops on the very tick after settlement.
    refetchInterval: (query) => {
      const order = query.state.data as P2POrder | undefined;
      return order && isOrderLive(order.status) ? LIVE_ORDER_POLL_MS : false;
    },
  });
}

/**
 * Report presence while a P2P screen is open.
 *
 * Drives the maker "online" dot. Deliberately tied to screen lifetime rather
 * than app lifetime: a user with the app backgrounded is not available to
 * answer a trade, and showing them as online sends takers to an ad nobody will
 * service.
 */
export function useP2PHeartbeat(enabled = true): void {
  useEffect(() => {
    if (!enabled) return;
    void heartbeat();
    // The server's online window is 5 minutes (ONLINE_WINDOW_MS in
    // lib/services/p2p.ts), so a 2-minute beat keeps the dot lit with margin
    // for one missed request.
    const timer = setInterval(() => void heartbeat(), 120_000);
    return () => clearInterval(timer);
  }, [enabled]);
}

/**
 * Invalidate everything an order transition can change.
 *
 * Both the order itself and the ad book: releasing an order frees escrow, which
 * changes the maker's `availableAmount` on every ad they run.
 */
export function useInvalidateP2P() {
  const qc = useQueryClient();
  return (orderId?: string) => {
    void qc.invalidateQueries({ queryKey: ["p2p", "orders"] });
    void qc.invalidateQueries({ queryKey: ["p2p", "ads"] });
    if (orderId) void qc.invalidateQueries({ queryKey: ["p2p", "order", orderId] });
  };
}

export { useMutation };
