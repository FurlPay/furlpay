// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearTelegramLaunchFragment, getTelegramWebApp, mountTelegram, type TelegramWebApp } from "../sdk";

afterEach(() => vi.unstubAllGlobals());
describe("official Telegram bridge lifecycle", () => {
  it("does not mistake the browser SDK stub for a Telegram launch", () => {
    expect(getTelegramWebApp()).toBeNull();
    vi.stubGlobal("Telegram", { WebApp: { initData: "", platform: "unknown" } });
    expect(getTelegramWebApp()).toBeNull();
  });
  it("removes signed launch data from browser history after the bridge is ready", () => {
    window.history.replaceState({ keep: true }, "", "/telegram/home?filter=card#tgWebAppData=signed&tgWebAppVersion=8.0");
    clearTelegramLaunchFragment();
    expect(window.location.pathname + window.location.search + window.location.hash).toBe("/telegram/home?filter=card");
    expect(window.history.state).toEqual({ keep: true });
  });
  it("synchronizes safe areas, responds to changes and removes every listener", () => {
    const listeners = new Map<string, () => void>();
    const app = { initData: "signed", platform: "ios", colorScheme: "dark", themeParams: { link_color: "#77aaff" }, viewportStableHeight: 700, safeAreaInset: { top: 10, bottom: 20, left: 0, right: 0 }, contentSafeAreaInset: { top: 15, bottom: 5, left: 0, right: 0 }, ready: vi.fn(), expand: vi.fn(), isVersionAtLeast: () => true, setHeaderColor: vi.fn(), setBackgroundColor: vi.fn(), setBottomBarColor: vi.fn(), onEvent: vi.fn((name, fn) => listeners.set(name, fn)), offEvent: vi.fn((name) => listeners.delete(name)), BackButton: { hide: vi.fn() }, MainButton: { hide: vi.fn() } } as unknown as TelegramWebApp;
    const root = document.createElement("div"); const cleanup = mountTelegram(app, root);
    expect(app.ready).toHaveBeenCalledOnce(); expect(app.expand).toHaveBeenCalledOnce();
    expect(root.style.getPropertyValue("--mini-safe-top")).toBe("25px");
    expect(root.style.getPropertyValue("--mini-safe-bottom")).toBe("25px");
    app.viewportStableHeight = 400; listeners.get("viewportChanged")?.();
    expect(root.style.getPropertyValue("--mini-viewport")).toBe("400px");
    app.colorScheme = "light"; listeners.get("themeChanged")?.(); expect(root.dataset.telegramTheme).toBe("light");
    cleanup(); expect(listeners.size).toBe(0); expect(app.MainButton.hide).toHaveBeenCalledOnce();
  });

  it("locks vertical swipes and wires the native Settings button, and undoes both on unmount", () => {
    const base = { initData: "signed", platform: "ios", colorScheme: "dark", themeParams: {}, viewportStableHeight: 0, ready: vi.fn(), expand: vi.fn(), setHeaderColor: vi.fn(), setBackgroundColor: vi.fn(), setBottomBarColor: vi.fn(), onEvent: vi.fn(), offEvent: vi.fn(), BackButton: { hide: vi.fn() }, MainButton: { hide: vi.fn() } };
    const settings = { show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() };
    const app = { ...base, isVersionAtLeast: () => true, disableVerticalSwipes: vi.fn(), enableVerticalSwipes: vi.fn(), SettingsButton: settings } as unknown as TelegramWebApp;
    const open = vi.fn();
    const cleanup = mountTelegram(app, document.createElement("div"), open);
    expect(app.disableVerticalSwipes).toHaveBeenCalledOnce();
    expect(settings.onClick).toHaveBeenCalledWith(open); expect(settings.show).toHaveBeenCalledOnce();
    cleanup();
    expect(settings.offClick).toHaveBeenCalledWith(open); expect(settings.hide).toHaveBeenCalledOnce();
    expect(app.enableVerticalSwipes).toHaveBeenCalledOnce();
  });

  it("does not call 7.x APIs on an older client", () => {
    const old = { initData: "signed", platform: "android", colorScheme: "dark", themeParams: {}, viewportStableHeight: 0, ready: vi.fn(), expand: vi.fn(), setHeaderColor: vi.fn(), setBackgroundColor: vi.fn(), onEvent: vi.fn(), offEvent: vi.fn(), BackButton: { hide: vi.fn() }, MainButton: { hide: vi.fn() }, isVersionAtLeast: (v: string) => v === "6.1", disableVerticalSwipes: vi.fn(), SettingsButton: { show: vi.fn(), hide: vi.fn(), onClick: vi.fn(), offClick: vi.fn() } } as unknown as TelegramWebApp;
    mountTelegram(old, document.createElement("div"), vi.fn())();
    expect(old.disableVerticalSwipes).not.toHaveBeenCalled();
    expect(old.SettingsButton?.show).not.toHaveBeenCalled();
  });
});
