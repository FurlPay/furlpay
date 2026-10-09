// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { getTelegramWebApp, mountTelegram, type TelegramWebApp } from "../sdk";

afterEach(() => vi.unstubAllGlobals());
describe("official Telegram bridge lifecycle", () => {
  it("does not mistake the browser SDK stub for a Telegram launch", () => {
    expect(getTelegramWebApp()).toBeNull();
    vi.stubGlobal("Telegram", { WebApp: { initData: "", platform: "unknown" } });
    expect(getTelegramWebApp()).toBeNull();
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
});
