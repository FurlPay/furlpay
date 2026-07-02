/// <reference lib="webworker" />
// Furlpay service worker (compiled to public/sw.js by @serwist/next).
//
// Caching policy, in match order:
//   1. /api/* and /.well-known/* — NETWORK ONLY, never cached. Auth, payments,
//      trades and the Digital Asset Links file must always hit the server.
//      (Offline read-only data lives in IndexedDB — see src/lib/offline.ts —
//      not in the SW cache, so it can be wiped precisely on logout.)
//   2. Page navigations — network-first with a 10s timeout, falling back to
//      the cached copy, then to the branded /~offline page.
//   3. /_next/static/* — cache-first (content-hashed, immutable).
//   4. Other same-origin assets + Google Fonts — stale-while-revalidate.
// Precache: the Next.js build manifest (JS/CSS chunks + public/ assets) and
// the /~offline fallback, so the app shell opens with no network at all.

import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import {
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  NetworkOnly,
  Serwist,
  StaleWhileRevalidate,
} from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}
declare const self: ServiceWorkerGlobalScope & WorkerGlobalScope;

const NEVER_CACHE = (pathname: string) =>
  pathname.startsWith("/api/") || pathname.startsWith("/.well-known/");

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ url, sameOrigin }) => sameOrigin && NEVER_CACHE(url.pathname),
      handler: new NetworkOnly(),
    },
    {
      matcher: ({ request }) => request.mode === "navigate",
      handler: new NetworkFirst({
        cacheName: "furlpay-pages",
        networkTimeoutSeconds: 10,
        plugins: [new ExpirationPlugin({ maxEntries: 64 })],
      }),
    },
    {
      // App Router client-side navigations fetch RSC payloads, not documents.
      // Caching them keeps in-app navigation working offline.
      matcher: ({ request, url, sameOrigin }) =>
        sameOrigin &&
        request.headers.get("RSC") === "1" &&
        !NEVER_CACHE(url.pathname),
      handler: new NetworkFirst({
        cacheName: "furlpay-pages-rsc",
        networkTimeoutSeconds: 10,
        plugins: [new ExpirationPlugin({ maxEntries: 128 })],
      }),
    },
    {
      matcher: ({ url, sameOrigin }) =>
        sameOrigin && url.pathname.startsWith("/_next/static/"),
      handler: new CacheFirst({
        cacheName: "furlpay-next-static",
        plugins: [new ExpirationPlugin({ maxEntries: 256 })],
      }),
    },
    {
      matcher: ({ request, sameOrigin }) =>
        sameOrigin &&
        ["style", "script", "worker", "image", "font"].includes(request.destination),
      handler: new StaleWhileRevalidate({
        cacheName: "furlpay-assets",
        plugins: [new ExpirationPlugin({ maxEntries: 128, maxAgeSeconds: 30 * 24 * 3600 })],
      }),
    },
    {
      matcher: ({ url }) =>
        url.origin === "https://fonts.googleapis.com" ||
        url.origin === "https://fonts.gstatic.com",
      handler: new CacheFirst({
        cacheName: "furlpay-google-fonts",
        plugins: [new ExpirationPlugin({ maxEntries: 16, maxAgeSeconds: 365 * 24 * 3600 })],
      }),
    },
  ],
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();
