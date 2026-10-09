"use client";

import Script from "next/script";
import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/components/auth/SessionProvider";
import { MiniAccountSchema, type MiniAccount } from "@/lib/telegram-mini-app/contracts";
import { getTelegramWebApp, mountTelegram, type TelegramWebApp } from "@/lib/telegram-mini-app/sdk";
import { telegramStartRoute } from "@/lib/telegram-mini-app/config";

type TelegramStatus = "browser" | "pending" | "active" | "link_required" | "error";
type DataStatus = "loading" | "ready" | "anonymous" | "error";
interface MiniContext {
  app: TelegramWebApp | null; telegramStatus: TelegramStatus; authError: string | null;
  account: MiniAccount | null; dataStatus: DataStatus; refresh(): Promise<void>;
  link(): Promise<void>; unlink(): Promise<void>; signOut(): Promise<void>; retryAuth(): void; haptic(): void;
  /** Running inside a cross-site frame (Telegram Web). Lax session cookies are not sent there. */
  embedded: boolean;
}
const Context = createContext<MiniContext | null>(null);
export function useMiniApp() { const c = useContext(Context); if (!c) throw new Error("Mini app provider is required"); return c; }

export default function TelegramProvider({ children }: { children: React.ReactNode }) {
  const { status: sessionStatus, refresh: refreshSession } = useSession();
  const router = useRouter();
  const root = useRef<HTMLDivElement>(null);
  const initialized = useRef(false);
  const mounted = useRef(true);
  const cleanup = useRef<(() => void) | null>(null);
  const requestSequence = useRef(0);
  const authInFlight = useRef<Promise<void> | null>(null);
  const [app, setApp] = useState<TelegramWebApp | null>(null);
  const [telegramStatus, setTelegramStatus] = useState<TelegramStatus>("browser");
  const [authError, setAuthError] = useState<string | null>(null);
  const [account, setAccount] = useState<MiniAccount | null>(null);
  const [dataStatus, setDataStatus] = useState<DataStatus>("loading");
  const [booted, setBooted] = useState(false);
  const [offline, setOffline] = useState(false);
  const [embedded, setEmbedded] = useState(false);

  const authenticate = useCallback((bridge: TelegramWebApp): Promise<void> => {
    if (authInFlight.current) return authInFlight.current;
    const attempt = async () => {
    setTelegramStatus("pending"); setAuthError(null);
    try {
      const response = await fetch("/api/auth/telegram", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ initData: bridge.initData }), cache: "no-store" });
      const body = await response.json();
      if (!response.ok || !["active", "link_required"].includes(body.status)) throw new Error(body.error || "Telegram sign-in could not be completed.");
      if (!mounted.current) return;
      setTelegramStatus(body.status);
      await refreshSession();
    } catch (e) {
      if (!mounted.current) return;
      setTelegramStatus("error"); setAuthError(e instanceof Error ? e.message : "Please reopen the mini app and try again.");
    }
    };
    authInFlight.current = attempt().finally(() => { authInFlight.current = null; });
    return authInFlight.current;
  }, [refreshSession]);

  const initialize = useCallback(() => {
    if (initialized.current) return;
    initialized.current = true;
    const bridge = getTelegramWebApp();
    if (bridge && root.current) {
      cleanup.current = mountTelegram(bridge, root.current);
      setApp(bridge);
      const start = telegramStartRoute(new URLSearchParams(bridge.initData).get("start_param"));
      if (start && window.location.pathname === "/telegram") router.replace(start);
      void authenticate(bridge);
    }
    setBooted(true);
  }, [authenticate, router]);

  useEffect(() => {
    mounted.current = true;
    try { setEmbedded(window.top !== window.self); } catch { setEmbedded(true); } // cross-origin top throws: framed
    const update = () => setOffline(!navigator.onLine);
    update(); window.addEventListener("online", update); window.addEventListener("offline", update);
    if (getTelegramWebApp()) initialize();
    // Normal browsers must not wait for an optional third-party SDK to use the app.
    const hasLaunch = /tgWebAppData=/.test(window.location.hash);
    if (!hasLaunch) setBooted(true);
    return () => { mounted.current = false; cleanup.current?.(); initialized.current = false; window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, [initialize]);

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    if (!booted || sessionStatus === "loading" || sessionStatus === "idle" || telegramStatus === "pending") return;
    if (sessionStatus !== "authenticated" || telegramStatus === "error") {
      setAccount(null); setDataStatus(sessionStatus === "error" || telegramStatus === "error" ? "error" : "anonymous"); return;
    }
    setDataStatus("loading");
    try {
      const response = await fetch("/api/miniapp/account", { cache: "no-store" });
      if (sequence !== requestSequence.current) return;
      if (response.status === 401) { setAccount(null); setDataStatus("anonymous"); await refreshSession(); return; }
      if (!response.ok) throw new Error("Account unavailable");
      const data = MiniAccountSchema.parse(await response.json());
      if (sequence !== requestSequence.current || !mounted.current) return;
      setAccount(data); setDataStatus("ready");
    } catch { if (sequence === requestSequence.current && mounted.current) { setAccount(null); setDataStatus("error"); } }
  }, [booted, sessionStatus, refreshSession, telegramStatus]);
  useEffect(() => { void refresh(); }, [refresh]);

  const link = async () => {
    if (!app) return;
    const response = await fetch("/api/miniapp/telegram-link", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ initData: app.initData }) });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || "Account linking failed. Please try again.");
    setTelegramStatus("active"); await refreshSession();
  };
  const unlink = async () => {
    const response = await fetch("/api/miniapp/telegram-link", { method: "DELETE" });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Couldn’t disconnect Telegram. Please try again.");
    if (app) setTelegramStatus("link_required");
    await refresh();
  };
  const signOut = async () => {
    const response = await fetch("/api/auth/logout", { method: "POST" });
    if (!response.ok) throw new Error("Sign-out failed. Please try again.");
    requestSequence.current++; setAccount(null); setDataStatus("anonymous");
    if (app) setTelegramStatus("link_required");
    await refreshSession();
  };

  const haptic = useCallback(() => { if (app?.isVersionAtLeast("6.1")) app.HapticFeedback?.selectionChanged(); }, [app]);
  return <Context.Provider value={{ app, account, dataStatus, refresh, telegramStatus, authError, link, unlink, embedded, signOut, retryAuth: () => { if (app) void authenticate(app); else void refreshSession(); }, haptic }}>
    <div className="fp-mini" ref={root}>
      <Script id="telegram-webapp" src="https://telegram.org/js/telegram-web-app.js?64" strategy="afterInteractive" onReady={initialize} onError={() => { setBooted(true); if (/tgWebAppData=/.test(window.location.hash)) { setTelegramStatus("error"); setAuthError("Telegram could not connect. Close and reopen the mini app."); } }} />
      {offline && <div className="mini-offline" role="status">You’re offline. Reconnect to refresh your account.</div>}
      {children}
    </div>
  </Context.Provider>;
}
