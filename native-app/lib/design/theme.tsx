import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AccessibilityInfo,
  Appearance,
  StyleSheet,
  useWindowDimensions,
  type TextStyle,
} from "react-native";
import { prefGet, prefSet } from "../db";
import {
  component,
  elevation,
  motion,
  noMotion,
  radius,
  schemes,
  sizeClassFor,
  spacing,
  touchTarget,
  typeScale,
  zIndex,
  type ColorScheme,
  type ElevationRole,
  type MotionScale,
  type SemanticColors,
  type SizeClass,
  type TypeRole,
} from "./tokens";

// ---------------------------------------------------------------------------
// Theme runtime.
//
// Three states, not two. "system" is the default and is NOT the same as
// resolving once at launch: the OS can flip schemes underneath a running app
// (sunset, battery saver, a scheduled dark mode), and an app that sampled the
// scheme at startup then keeps rendering the stale one. Appearance is
// subscribed to, so the flip lands live.
// ---------------------------------------------------------------------------

export type ThemeMode = "system" | "light" | "dark";

const PREF_KEY = "ui.theme";

function readStoredMode(): ThemeMode {
  const raw = prefGet(PREF_KEY);
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

export interface Theme {
  /** What the user asked for. */
  mode: ThemeMode;
  /** What that resolves to right now. Never "system". */
  scheme: ColorScheme;
  colors: SemanticColors;
  spacing: typeof spacing;
  radius: typeof radius;
  component: typeof component;
  zIndex: typeof zIndex;
  touchTarget: typeof touchTarget;
  /** Animation durations, already zeroed if the user asked for reduced motion. */
  motion: MotionScale;
  reduceMotion: boolean;
  /** OS text-size multiplier, clamped. */
  fontScale: number;
  sizeClass: SizeClass;
  /** Resolved type style for a role, with font scaling and tabular digits applied. */
  type: (role: TypeRole) => TextStyle;
  /** Platform-correct shadow for a role, tinted for the current scheme. */
  elevation: (role: ElevationRole) => Record<string, unknown>;
}

interface ThemeContextValue extends Theme {
  setMode: (m: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Font-scale clamp.
 *
 * Android and iOS both go past 200%, and at 3.1x an amount like
 * "-1,234.56 USDC" no longer fits a phone's width at any sane layout. Clamping
 * at 1.6 keeps the app usable for people who need larger text without letting a
 * confirmation screen push its Confirm button off the bottom — which would be a
 * safety problem, not a cosmetic one. Below 1.0 is left alone.
 */
const MAX_FONT_SCALE = 1.6;

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const [systemScheme, setSystemScheme] = useState<ColorScheme>(
    () => (Appearance.getColorScheme() === "light" ? "light" : "dark")
  );
  const [reduceMotion, setReduceMotion] = useState(false);
  const { fontScale: rawFontScale, width, height } = useWindowDimensions();

  // Live OS scheme. Subscribed unconditionally rather than only while
  // mode === "system": if we unsubscribed, switching back to "system" would
  // resolve against whatever the scheme was when we stopped listening.
  useEffect(() => {
    const sub = Appearance.addChangeListener(({ colorScheme }) => {
      setSystemScheme(colorScheme === "light" ? "light" : "dark");
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((v) => {
      if (alive) setReduceMotion(v);
    });
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    prefSet(PREF_KEY, m);
  }, []);

  const scheme: ColorScheme = mode === "system" ? systemScheme : mode;
  const fontScale = Math.min(rawFontScale || 1, MAX_FONT_SCALE);
  const sizeClass = sizeClassFor(Math.min(width, height));

  const value = useMemo<ThemeContextValue>(() => {
    const colors = schemes[scheme];

    const resolvedMotion: MotionScale = reduceMotion ? noMotion : motion;

    const type = (role: TypeRole): TextStyle => {
      const t = typeScale[role] as {
        fontSize: number;
        lineHeight: number;
        fontWeight: string;
        letterSpacing?: number;
        mono?: boolean;
        tabular?: boolean;
      };
      const style: TextStyle = {
        fontSize: Math.round(t.fontSize * fontScale),
        lineHeight: Math.round(t.lineHeight * fontScale),
        fontWeight: t.fontWeight as TextStyle["fontWeight"],
        color: colors.text,
      };
      if (t.letterSpacing) style.letterSpacing = t.letterSpacing;
      if (t.mono) style.fontFamily = "monospace";
      // Digits that line up. Applied at the token level so every amount in the
      // app gets it without each screen remembering to ask.
      if (t.tabular) style.fontVariant = ["tabular-nums"];
      return style;
    };

    const elevationFor = (role: ElevationRole) => {
      const e = elevation[role];
      return {
        elevation: e.elevation,
        // A black shadow is invisible on a black ground, so the dark scheme
        // spends its depth budget on the border instead of a shadow nobody can
        // see. Light gets a real, soft shadow.
        shadowColor: scheme === "dark" ? "#000000" : "#0A1512",
        shadowOpacity: scheme === "dark" ? e.shadowOpacity * 0.5 : e.shadowOpacity,
        shadowRadius: e.shadowRadius,
        shadowOffset: e.shadowOffset,
      };
    };

    return {
      mode,
      setMode,
      scheme,
      colors,
      spacing,
      radius,
      component,
      zIndex,
      touchTarget,
      motion: resolvedMotion,
      reduceMotion,
      fontScale,
      sizeClass,
      type,
      elevation: elevationFor,
    };
  }, [scheme, mode, setMode, reduceMotion, fontScale, sizeClass]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * The theme.
 *
 * Falls back to a resolved dark theme rather than throwing when no provider is
 * mounted. A missing provider is a developer error, but the places it shows up
 * are error boundaries and crash screens — the exact moments when throwing a
 * SECOND error turns a recoverable render failure into a blank app.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  return ctx ?? FALLBACK;
}

const FALLBACK: ThemeContextValue = (() => {
  const colors = schemes.dark;
  return {
    mode: "system",
    setMode: () => {},
    scheme: "dark",
    colors,
    spacing,
    radius,
    component,
    zIndex,
    touchTarget,
    motion,
    reduceMotion: false,
    fontScale: 1,
    sizeClass: "compact",
    type: (role) => {
      const t = typeScale[role] as { fontSize: number; lineHeight: number; fontWeight: string };
      return {
        fontSize: t.fontSize,
        lineHeight: t.lineHeight,
        fontWeight: t.fontWeight as TextStyle["fontWeight"],
        color: colors.text,
      };
    },
    elevation: (role) => ({ ...elevation[role], shadowColor: "#000000" }),
  };
})();

/**
 * Build a themed stylesheet.
 *
 * `StyleSheet.create` snapshots its values, so a stylesheet built at module
 * scope bakes in whichever scheme was current when the module loaded — which
 * is exactly why the app could not support light mode before. This builds one
 * sheet per scheme and caches it, so switching themes is a map lookup rather
 * than a rebuild, and no screen pays for `create` on every render.
 *
 *   const useStyles = makeStyles((t) => ({
 *     card: { backgroundColor: t.colors.surface, padding: t.spacing.md },
 *   }));
 *   // in the component:
 *   const s = useStyles();
 */
export function makeStyles<T extends StyleSheet.NamedStyles<T>>(
  factory: (theme: Theme) => T
): () => T {
  const cache = new Map<string, T>();
  return function useStyles(): T {
    const theme = useTheme();
    // Font scale and reduced motion change layout, so they are part of the key.
    const key = `${theme.scheme}:${theme.fontScale}:${theme.reduceMotion ? 1 : 0}`;
    const cached = cache.get(key);
    if (cached) return cached;
    const created = StyleSheet.create(factory(theme));
    cache.set(key, created);
    return created;
  };
}

/**
 * Announce something to a screen reader.
 *
 * Used for state changes that are visible but not focusable — "Payment sent",
 * "Quote expired". Without an explicit announcement a sighted user sees the
 * confirmation and a TalkBack user sees nothing at all.
 */
export function announce(message: string): void {
  AccessibilityInfo.announceForAccessibility(message);
}

/** True while a screen reader is running. */
export function useScreenReader(): boolean {
  const [on, setOn] = useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isScreenReaderEnabled().then((v) => {
      if (alive) setOn(v);
    });
    const sub = AccessibilityInfo.addEventListener("screenReaderChanged", setOn);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  return on;
}

/**
 * A ref that is focused by the screen reader when a screen mounts.
 *
 * Route changes in expo-router do not move screen-reader focus on Android, so
 * without this TalkBack stays on the element the user tapped on the PREVIOUS
 * screen and reads nothing about the new one.
 */
export function useInitialFocus<T extends { focus?: () => void }>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const t = setTimeout(() => {
      const node = ref.current as unknown as number | null;
      if (node != null) AccessibilityInfo.setAccessibilityFocus(node as number);
    }, 250);
    return () => clearTimeout(t);
  }, []);
  return ref;
}
