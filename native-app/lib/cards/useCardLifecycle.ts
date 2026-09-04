import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError } from "@/lib/api";
import type { PaymentCard } from "@/lib/types";
import {
  activateCard,
  closeCard,
  fetchCardLifecycle,
  fetchCardProducts,
  orderCard,
  reissueCard,
  reportCardLost,
  setCardPin,
  setCardProvisioning,
  setCardTheme,
  updateCardShipping,
  verifyCardPin,
  type CardLifecycle,
  type OrderCardInput,
  type ShippingAddress,
} from "./lifecycle";

// ---------------------------------------------------------------------------
// Card lifecycle state.
//
// EVERY MUTATION RETURNS THE UPDATED LIFECYCLE, so each one writes its result
// straight into the cache instead of invalidating and refetching. That is not
// only a speed choice: freezing a card and watching the row sit unchanged for a
// round trip is exactly the moment a worried user taps again.
//
// THE CARD LIST IS INVALIDATED SEPARATELY, because several of these mutations
// change the PaymentCard as well as the lifecycle — activation lifts the
// freeze, closing sets it, a reissue mints a whole new card. `/cards` is the
// authority on that half, so anything that can move it says so explicitly
// rather than relying on a blanket refetch.
// ---------------------------------------------------------------------------

export const CARD_PRODUCTS_KEY = ["cards", "products"] as const;

const lifecycleKey = (cardId: string) => ["cards", "lifecycle", cardId] as const;

/** What this account may order, and why it may not order the rest. */
export function useCardProducts() {
  const query = useQuery({
    queryKey: CARD_PRODUCTS_KEY,
    queryFn: ({ signal }) => fetchCardProducts(signal),
    // The catalogue changes with the account's tier and KYC state, not by the
    // minute — but it must not be stale across a plan upgrade, so this is
    // shorter than it looks like it should be.
    staleTime: 60_000,
  });
  return {
    products: query.data?.products ?? [],
    themes: query.data?.themes ?? [],
    isLoading: query.isLoading,
    error: query.error as Error | null,
    loaded: query.data !== undefined,
    refetch: query.refetch,
  };
}

/**
 * One card's lifecycle.
 *
 * Cards created before the lifecycle module are adopted by the server on first
 * read, so this reports `active` rather than 404 for them — the client needs no
 * special case.
 */
export function useCardLifecycle(cardId: string | undefined) {
  return useQuery({
    queryKey: lifecycleKey(cardId ?? ""),
    queryFn: ({ signal }) => fetchCardLifecycle(cardId as string, signal),
    enabled: !!cardId,
    staleTime: 15_000,
  });
}

/**
 * Turn a lifecycle-route error into something a user can act on.
 *
 * These routes answer with `{ ok: false, error: "<sentence>" }` and a 409 —
 * the message is already written for a human ("Metal requires the Pro plan",
 * "Card limit reached"), so it is preferred over anything invented here. The
 * fallbacks cover a transport failure, where there is no server sentence.
 */
export function cardErrorMessage(e: unknown): string {
  if (e instanceof ApiError) {
    const data = e.data as { error?: string; message?: string } | null;
    const raw = data?.error ?? data?.message;
    if (raw && raw !== "not_found") return raw;
    if (e.status === 404) return "That card no longer exists.";
    if (e.status === 429) return "Too many attempts. Wait a minute and try again.";
    return e.message;
  }
  return e instanceof Error ? e.message : "Something went wrong.";
}

/** Every write against a card's lifecycle, sharing one cache-update path. */
export function useCardLifecycleMutations(cardId: string | undefined) {
  const qc = useQueryClient();

  const write = useCallback(
    (lc: CardLifecycle) => {
      qc.setQueryData(lifecycleKey(lc.cardId), lc);
    },
    [qc]
  );

  /** For mutations that also change the PaymentCard itself. */
  const writeAndRefreshCards = useCallback(
    (lc: CardLifecycle) => {
      write(lc);
      void qc.invalidateQueries({ queryKey: ["cards"] });
    },
    [qc, write]
  );

  const id = () => {
    if (!cardId) throw new Error("No card selected.");
    return cardId;
  };

  // Activation lifts the freeze the card shipped with, so the card list moves.
  const activate = useMutation({
    mutationFn: (code: string) => activateCard(id(), code),
    onSuccess: writeAndRefreshCards,
  });

  const setPin = useMutation({
    mutationFn: (pin: string) => setCardPin(id(), pin),
    onSuccess: write,
  });

  // Deliberately NOT onSuccess-writing: verify returns a PinVerifyResult, not a
  // lifecycle. It does move `pinLockedUntil` though, so the lifecycle is
  // invalidated rather than patched.
  const verifyPin = useMutation({
    mutationFn: (pin: string) => verifyCardPin(id(), pin),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: lifecycleKey(cardId ?? "") });
    },
  });

  // The theme is the card's gradient, which the card list renders.
  const setTheme = useMutation({
    mutationFn: (themeId: string) => setCardTheme(id(), themeId),
    onSuccess: writeAndRefreshCards,
  });

  const setShipping = useMutation({
    mutationFn: (address: ShippingAddress) => updateCardShipping(id(), address),
    onSuccess: write,
  });

  const setProvisioning = useMutation({
    mutationFn: (input: { wallet: "googlePay" | "applePay"; enabled: boolean }) =>
      setCardProvisioning(id(), input.wallet, input.enabled),
    onSuccess: write,
  });

  // Both terminal transitions freeze the card server-side.
  const reportLost = useMutation({
    mutationFn: () => reportCardLost(id()),
    onSuccess: writeAndRefreshCards,
  });

  const close = useMutation({
    mutationFn: () => closeCard(id()),
    onSuccess: writeAndRefreshCards,
  });

  const reissue = useMutation({
    mutationFn: (input: {
      label: string;
      shipping?: ShippingAddress;
      idempotencyKey: string;
    }) =>
      reissueCard(
        id(),
        { label: input.label, ...(input.shipping ? { shipping: input.shipping } : {}) },
        input.idempotencyKey
      ),
    onSuccess: (result) => {
      // Two lifecycles move: the replacement is new, and the old card's record
      // is updated with `replacedByCardId`.
      write(result.lifecycle);
      write(result.previous);
      void qc.invalidateQueries({ queryKey: ["cards"] });
    },
  });

  return {
    activate,
    setPin,
    verifyPin,
    setTheme,
    setShipping,
    setProvisioning,
    reportLost,
    close,
    reissue,
    busy:
      activate.isPending ||
      setPin.isPending ||
      verifyPin.isPending ||
      setTheme.isPending ||
      setShipping.isPending ||
      setProvisioning.isPending ||
      reportLost.isPending ||
      close.isPending ||
      reissue.isPending,
  };
}

/** Ordering a card. Separate from the per-card mutations: there is no card id
 *  yet, and the result has to land in the card list before anything can be
 *  done with it. */
export function useOrderCard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: OrderCardInput & { idempotencyKey: string }) => {
      const { idempotencyKey, ...body } = input;
      return orderCard(body, idempotencyKey);
    },
    onSuccess: (result) => {
      qc.setQueryData(lifecycleKey(result.lifecycle.cardId), result.lifecycle);
      // Append rather than invalidate, so the new card is on screen before the
      // refetch lands. The invalidation still follows: `/cards` is the
      // authority and the optimistic row must not outlive a disagreement.
      qc.setQueryData<{ data: PaymentCard[]; fromCache: boolean; updatedAt: number }>(
        ["cards"],
        (prev) =>
          prev ? { ...prev, data: [...prev.data, result.card] } : prev
      );
      void qc.invalidateQueries({ queryKey: ["cards"] });
      void qc.invalidateQueries({ queryKey: CARD_PRODUCTS_KEY });
    },
  });
}
