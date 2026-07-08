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

// ---------------------------------------------------------------------------
// Web Push — 3DS2 out-of-band transaction approvals.
// The card-auth webhook pushes { title, body, url, tag, data } payloads; the
// notification deep-links into /cards/approve where the user resolves the
// challenge with a passkey (biometric) assertion. In the Android TWA these
// render as native notifications via FCM.
// ---------------------------------------------------------------------------

interface FurlpayPushPayload {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
  data?: Record<string, unknown>;
}

self.addEventListener("push", (event) => {
  let payload: FurlpayPushPayload = {};
  try {
    payload = event.data?.json() ?? {};
  } catch {
    payload = { body: event.data?.text() };
  }
  const title = payload.title ?? "Furlpay";
  event.waitUntil(
    self.registration.showNotification(title, {
      body: payload.body ?? "",
      tag: payload.tag,
      icon: "/icon.png",
      badge: "/icon.png",
      // Approvals are time-critical: keep the notification up until acted on.
      requireInteraction: true,
      data: { url: payload.url ?? "/", ...payload.data },
    } as NotificationOptions)
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url: string = (event.notification.data as { url?: string })?.url ?? "/";
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      // Focus an existing app window and navigate it, else open a new one.
      for (const client of clients) {
        if ("focus" in client) {
          await client.focus();
          if ("navigate" in client) await (client as WindowClient).navigate(url);
          return;
        }
      }
      await self.clients.openWindow(url);
    })()
  );
});
