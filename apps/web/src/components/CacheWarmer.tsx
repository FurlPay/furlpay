"use client";

import { useEffect } from "react";

// Warms the service worker's page cache with the app-shell routes so the app
// opens offline even for pages the user never full-navigated to (App Router
// moves between pages client-side, so their HTML is otherwise never cached).
//
// Public routes are always warmed. Protected routes are warmed only from an
// authenticated context (`authed` = the current page sat behind the session
// middleware) — warming them logged-out would follow the /login redirect and
// poison the cache with login HTML under the dashboard's URL.

const PUBLIC_ROUTES = ["/", "/login"];
const PROTECTED_ROUTES = [
  "/dashboard",
  "/banking",
  "/portfolio",
  "/markets",
  "/cards",
  "/bills",
  "/profile",
  "/earn",
  "/credit",
  "/rewards",
  "/spending",
];
const PAGE_CACHE = "furlpay-pages"; // must match sw.ts

export default function CacheWarmer({ authed }: { authed: boolean }) {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || typeof caches === "undefined") return;
    let cancelled = false;

    navigator.serviceWorker.ready
      .then(async () => {
        if (cancelled) return;
        const cache = await caches.open(PAGE_CACHE);
        const routes = authed ? [...PUBLIC_ROUTES, ...PROTECTED_ROUTES] : PUBLIC_ROUTES;
        await Promise.allSettled(
          routes.map(async (url) => {
            if (await cache.match(url)) return; // already cached (fresh copies come via NetworkFirst)
            const res = await fetch(url, { credentials: "same-origin" });
            // Only store the real page — a redirect means we hit the auth wall.
            if (res.ok && !res.redirected) await cache.put(url, res);
          })
        );
      })
      .catch(() => {
        /* cache warming is best-effort */
      });

    return () => {
      cancelled = true;
    };
  }, [authed]);

  return null;
}
