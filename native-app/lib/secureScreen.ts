import { useEffect } from "react";
import * as ScreenCapture from "expo-screen-capture";

// ---------------------------------------------------------------------------
// Screenshot / screen-record / recents-thumbnail protection for screens that
// render sensitive material (card PAN + CVV, 3DS approval amounts, passkey
// inventory, deposit address). Sets Android FLAG_SECURE while the screen is
// mounted and lifts it on unmount, so the rest of the app stays screenshottable.
//
// A `tag` scopes the block so two protected screens on the stack don't lift
// each other's protection when the top one unmounts.
// ---------------------------------------------------------------------------

export function useSecureScreen(tag: string): void {
  useEffect(() => {
    let active = true;
    void ScreenCapture.preventScreenCaptureAsync(tag).catch(() => {
      // Best-effort — a device that can't honor the flag must not crash the app.
    });
    return () => {
      active = false;
      void ScreenCapture.allowScreenCaptureAsync(tag).catch(() => {});
      void active; // silence unused in strict builds
    };
  }, [tag]);
}
