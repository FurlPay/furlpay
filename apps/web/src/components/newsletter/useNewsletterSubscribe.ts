"use client";

import { useCallback, useState } from "react";
import { EMAIL_RE, type CategoryId } from "./categories";

// Shared submit logic for every newsletter surface. Previously each component
// re-implemented fetch + status handling, so a fix (say, distinguishing a
// server error from a network error) only ever landed on one of them.

export type SubscribeStatus = "idle" | "loading" | "success" | "error";

const TIMEOUT_MS = 10_000;

async function post(url: string, payload: unknown): Promise<{ ok: boolean; body: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  // A 500/502 can arrive as an HTML error page; `res.json()` throwing there
  // must not be reported to the user as "network error".
  let body: Record<string, unknown> = {};
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }
  return { ok: res.ok, body };
}

function messageFrom(body: Record<string, unknown>, fallback: string): string {
  const value = typeof body.message === "string" ? body.message : body.error;
  return typeof value === "string" && value.trim() ? value : fallback;
}

export function useNewsletterSubscribe() {
  const [status, setStatus] = useState<SubscribeStatus>("idle");
  const [message, setMessage] = useState("");

  const reset = useCallback(() => {
    setStatus("idle");
    setMessage("");
  }, []);

  const fail = useCallback((text: string) => {
    setStatus("error");
    setMessage(text);
    return false;
  }, []);

  const subscribe = useCallback(
    async (email: string, categories: CategoryId[]): Promise<boolean> => {
      const address = email.trim();
      if (!EMAIL_RE.test(address)) {
        return fail("Please enter a valid email address.");
      }
      if (categories.length === 0) {
        return fail("Select at least one topic to subscribe to.");
      }

      setStatus("loading");
      setMessage("");
      try {
        const { ok, body } = await post("/api/newsletter/subscribe", {
          email: address,
          categories,
        });
        if (!ok) {
          return fail(messageFrom(body, "Something went wrong. Please try again."));
        }
        setStatus("success");
        setMessage(messageFrom(body, "You're subscribed!"));
        return true;
      } catch (err) {
        const name = err instanceof Error ? err.name : "";
        return fail(
          name === "TimeoutError" || name === "AbortError"
            ? "That took too long. Please try again."
            : "Network error. Please check your connection and try again."
        );
      }
    },
    [fail]
  );

  const unsubscribe = useCallback(
    async (email: string, categories?: CategoryId[]): Promise<boolean> => {
      const address = email.trim();
      if (!EMAIL_RE.test(address)) {
        return fail("Please enter a valid email address.");
      }

      setStatus("loading");
      setMessage("");
      try {
        const { ok, body } = await post("/api/newsletter/unsubscribe", {
          email: address,
          // Omit the key entirely for a full unsubscribe — an empty array and
          // "no selection" mean the same thing to the route, but sending
          // `undefined` inside JSON.stringify would drop it anyway.
          ...(categories && categories.length > 0 ? { categories } : {}),
        });
        if (!ok) {
          return fail(messageFrom(body, "Something went wrong. Please try again."));
        }
        setStatus("success");
        setMessage(messageFrom(body, "You've been unsubscribed."));
        return true;
      } catch (err) {
        const name = err instanceof Error ? err.name : "";
        return fail(
          name === "TimeoutError" || name === "AbortError"
            ? "That took too long. Please try again."
            : "Network error. Please check your connection and try again."
        );
      }
    },
    [fail]
  );

  return { status, message, subscribe, unsubscribe, reset } as const;
}
