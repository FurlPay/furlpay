import * as Haptics from "expo-haptics";

// ---------------------------------------------------------------------------
// FurlPay haptic vocabulary — the pulse strength encodes the WEIGHT of what
// happened, mirroring the watch app's Haptics.kt so the brand feels the same
// on every surface:
//
//   tap      light   any button press
//   select   tick    tab switch, chip toggle, copy
//   found    medium  something appeared (watch discovered, QR scanned)
//   commit   heavy   a financial/irreversible action fired (freeze, send)
//   success  chord   the thing completed (payment sent, watch connected)
//   warning  buzz    needs attention (budget, watch lost)
//   error    buzz    failed
//
// All fire-and-forget: haptics must never block or throw into UI code.
// ---------------------------------------------------------------------------

const quiet = (p: Promise<void>) => {
  p.catch(() => {});
};

export const haptic = {
  tap: () => quiet(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)),
  select: () => quiet(Haptics.selectionAsync()),
  found: () => quiet(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)),
  commit: () => quiet(Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)),
  success: () => quiet(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)),
  warning: () => quiet(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)),
  error: () => quiet(Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)),
} as const;
