"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

// ---------------------------------------------------------------------------
// Who is signed in, shared across the client tree.
//
// One fetch of /api/auth/session, one source of truth. Before this, anything
// that needed identity called /api/profile and got a 401 for an anonymous
// reader — fine on a gated page, wrong on /markets, which is public and renders
// a header avatar for everyone.
//
// LAZY ON PURPOSE. The provider is mounted at the root, above marketing pages
// and docs that have no interest in identity, so it does not fetch until a
// component actually calls useSession(). A landing page therefore costs zero
// extra requests, and the first consumer to mount pays for everyone.
//
// The state is an explicit union rather than a nullable user, because "we have
// not asked yet" and "nobody is signed in" produce different UI — a skeleton
// versus a sign-in prompt — and collapsing them makes the avatar flash from
// signed-out to signed-in on every page load.
// ---------------------------------------------------------------------------

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  /** Up to two letters from the real name, or null when there is no name. */
  initials: string | null;
  /** A provider-hosted profile photo, when one is known. */
  avatarUrl: string | null;
  tier: string;
}

export type SessionStatus =
  | "idle" // no consumer has asked yet
  | "loading"
  | "authenticated"
  | "anonymous"
  | "expired" // a credential was offered and rejected — say so
  | "error"; // the request itself failed; do not claim signed-out

export interface SessionState {
  status: SessionStatus;
  user: SessionUser | null;
  /** Re-read the session — call after a sign-in or sign-out. */
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionState | null>(null);

interface SessionResponse {
  status: "active" | "anonymous" | "expired";
  user: SessionUser | null;
}

export default function SessionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>("idle");
  const [user, setUser] = useState<SessionUser | null>(null);
  // Guards the lazy first load: many components may call useSession() in the
  // same commit, and only one of them should start a request.
  const started = useRef(false);

  const load = useCallback(async () => {
    setStatus((s) => (s === "idle" ? "loading" : s));
    try {
      const res = await fetch("/api/auth/session", { cache: "no-store" });
      if (!res.ok) throw new Error(`session ${res.status}`);
      const data = (await res.json()) as SessionResponse;
      if (data.status === "active" && data.user) {
        setUser(data.user);
        setStatus("authenticated");
      } else {
        setUser(null);
        setStatus(data.status === "expired" ? "expired" : "anonymous");
      }
    } catch {
      // A failed request is NOT proof that nobody is signed in. Saying
      // "anonymous" here would offer a sign-in button to someone who already
      // has a session, and hide their watchlist behind it.
      setUser(null);
      setStatus("error");
    }
  }, []);

  const ensureLoaded = useCallback(() => {
    if (started.current) return;
    started.current = true;
    void load();
  }, [load]);

  const refresh = useCallback(async () => {
    started.current = true;
    await load();
  }, [load]);

  const value = useMemo<SessionState & { ensureLoaded: () => void }>(
    () => ({ status, user, refresh, ensureLoaded }),
    [status, user, refresh, ensureLoaded]
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

/**
 * The current session. Triggers the one lazy load on first use.
 *
 * Outside a provider this returns a permanently anonymous session rather than
 * throwing: a component rendered in isolation (a test, a storybook page) should
 * degrade to its signed-out state, not crash the tree.
 */
export function useSession(): SessionState {
  const ctx = useContext(SessionContext) as (SessionState & { ensureLoaded?: () => void }) | null;
  const ensure = ctx?.ensureLoaded;

  useEffect(() => {
    ensure?.();
  }, [ensure]);

  const fallback = useMemo<SessionState>(
    () => ({ status: "anonymous", user: null, refresh: async () => {} }),
    []
  );
  return ctx ?? fallback;
}

/** Convenience: true only for a confirmed session. "error" and "loading" are
 *  not signed in, and are not signed out either. */
export function useIsAuthenticated(): boolean {
  return useSession().status === "authenticated";
}
