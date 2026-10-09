/** Narrow, documented official WebApp bridge. No server identity is taken from initDataUnsafe. */
export interface TelegramWebApp {
  initData: string;
  version: string;
  platform: string;
  colorScheme: string;
  themeParams: { button_color?: string; link_color?: string };
  viewportHeight: number;
  viewportStableHeight: number;
  safeAreaInset?: Insets;
  contentSafeAreaInset?: Insets;
  ready(): void;
  expand(): void;
  isVersionAtLeast(version: string): boolean;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  setBottomBarColor?(color: string): void;
  onEvent(event: string, callback: () => void): void;
  offEvent(event: string, callback: () => void): void;
  BackButton: { show(): void; hide(): void; onClick(fn: () => void): void; offClick(fn: () => void): void };
  MainButton: { setParams(params: { text: string; color: string; text_color: string; is_active: boolean; is_visible: boolean }): void; show(): void; hide(): void; onClick(fn: () => void): void; offClick(fn: () => void): void };
  HapticFeedback?: { selectionChanged(): void };
}
interface Insets { top: number; bottom: number; left: number; right: number }
export function getTelegramWebApp(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  const app = (window as Window & { Telegram?: { WebApp?: TelegramWebApp } }).Telegram?.WebApp;
  return app?.initData && app.platform !== "unknown" ? app : null;
}
export function mountTelegram(app: TelegramWebApp, root: HTMLElement): () => void {
  const sync = () => {
    root.dataset.telegramTheme = app.colorScheme;
    if (app.viewportStableHeight > 0) root.style.setProperty("--mini-viewport", `${app.viewportStableHeight}px`);
    for (const side of ["top", "bottom", "left", "right"] as const) {
      const inset = Math.max(0, app.safeAreaInset?.[side] ?? 0) + Math.max(0, app.contentSafeAreaInset?.[side] ?? 0);
      root.style.setProperty(`--mini-safe-${side}`, `${inset}px`);
    }
    const accent = app.themeParams.link_color;
    if (accent && /^#[0-9a-f]{6}$/i.test(accent)) root.style.setProperty("--mini-telegram-accent", accent);
  };
  sync();
  app.ready(); app.expand();
  if (app.isVersionAtLeast("6.1")) { app.setHeaderColor("#080a0d"); app.setBackgroundColor("#080a0d"); }
  if (app.isVersionAtLeast("7.10")) app.setBottomBarColor?.("#0d1118");
  const events = ["themeChanged", "viewportChanged", ...(app.isVersionAtLeast("8.0") ? ["safeAreaChanged", "contentSafeAreaChanged"] : [])];
  events.forEach(e => app.onEvent(e, sync));
  return () => { events.forEach(e => app.offEvent(e, sync)); app.BackButton?.hide(); app.MainButton?.hide(); };
}
