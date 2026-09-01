// ---------------------------------------------------------------------------
// Device compass heading.
//
// Reads the phone's magnetometer through the DeviceOrientationEvent, which is
// the web's only access to compass data. The heading is degrees clockwise from
// True North — the same convention Google Maps, MapLibre and every other map
// uses for bearing.
//
// THREE PATHS, because no two browser vendors agreed on the same API surface:
//
//   iOS Safari   `webkitCompassHeading` on the standard event, which is
//                directly degrees-clockwise-from-north with no conversion.
//                Requires a one-time `requestPermission()` call from a user
//                gesture (tap), and throws if you try it without one.
//
//   Android      `deviceorientationabsolute` event, where `alpha` is
//                counter-clockwise from north. Heading = (360 - alpha) % 360.
//
//   Desktop      Usually has no magnetometer. Returns nothing, and the caller
//                should hide the compass UI entirely rather than showing a
//                broken one.
//
// SCREEN ROTATION. A phone in landscape reports a different alpha than in
// portrait for the same physical heading, because alpha measures rotation
// relative to the screen's top, not the device's long edge. The screen
// orientation angle is added back so the heading stays stable.
//
// WHAT THIS DOES NOT DO. It does not calibrate — that is the OS's job, and on
// the web there is no API to trigger the figure-8 gesture or Live View. What
// it CAN do is read the result of the OS's calibration, which means a phone
// that has been calibrated (by any method) will send an accurate heading here.
// ---------------------------------------------------------------------------

export interface HeadingState {
  /** Degrees clockwise from True North, [0, 360). */
  heading: number;
  /** The accuracy the OS reported, when it did. Lower is better. */
  accuracy: number | null;
}

export type HeadingCallback = (state: HeadingState) => void;

/**
 * Request permission for device orientation on iOS 13+.
 *
 * MUST be called from a user gesture (click/tap handler). Returns true if
 * heading data will be available, false if denied or unsupported.
 */
export async function requestOrientationPermission(): Promise<boolean> {
  // iOS 13+ gates the event behind a permission prompt.
  if (
    typeof DeviceOrientationEvent !== "undefined" &&
    typeof (DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> })
      .requestPermission === "function"
  ) {
    try {
      const result = await (
        DeviceOrientationEvent as unknown as { requestPermission: () => Promise<string> }
      ).requestPermission();
      return result === "granted";
    } catch {
      return false;
    }
  }
  // Non-iOS: the event fires without a prompt. Whether it contains useful data
  // depends on the hardware; that is discovered when the first event arrives.
  return typeof window !== "undefined" && "DeviceOrientationEvent" in window;
}

/**
 * Subscribe to compass heading updates.
 *
 * Returns a cleanup function. Call it to stop listening — otherwise the
 * magnetometer stays powered, which costs battery.
 */
export function watchHeading(cb: HeadingCallback): () => void {
  if (typeof window === "undefined") return () => {};

  let lastHeading = -1;

  const screenAngle = (): number => {
    if (window.screen?.orientation) return window.screen.orientation.angle;
    // Legacy fallback, which window.orientation is.
    return (window as unknown as { orientation?: number }).orientation ?? 0;
  };

  const handler = (e: DeviceOrientationEvent) => {
    let heading: number | null = null;
    let accuracy: number | null = null;

    // iOS: the straightforward path.
    const webkit = (e as unknown as { webkitCompassHeading?: number; webkitCompassAccuracy?: number });
    if (typeof webkit.webkitCompassHeading === "number" && webkit.webkitCompassHeading >= 0) {
      heading = webkit.webkitCompassHeading;
      accuracy = typeof webkit.webkitCompassAccuracy === "number" ? webkit.webkitCompassAccuracy : null;
    }
    // Android / generic: alpha is counter-clockwise from north when the event
    // is absolute. Non-absolute events are useless for a compass.
    else if ((e.absolute || e.type === "deviceorientationabsolute") && e.alpha !== null) {
      heading = (360 - e.alpha) % 360;
      accuracy = null;
    }

    if (heading === null) return;

    // Compensate for screen rotation.
    heading = (heading + screenAngle()) % 360;

    // Suppress callbacks when the heading has not meaningfully changed —
    // magnetometer jitter fires the event at 60 Hz with sub-degree changes,
    // and re-rendering a marker rotation on every one is pure waste.
    const rounded = Math.round(heading);
    if (rounded === lastHeading) return;
    lastHeading = rounded;

    cb({ heading, accuracy });
  };

  // Prefer the absolute event (Android). Fall back to the standard event,
  // which is where iOS puts its data.
  const eventName: string =
    "ondeviceorientationabsolute" in window ? "deviceorientationabsolute" : "deviceorientation";
  window.addEventListener(eventName, handler as EventListener, true);

  return () => {
    window.removeEventListener(eventName, handler as EventListener, true);
  };
}
