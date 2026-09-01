// ---------------------------------------------------------------------------
// User location tracking for the hotel map.
//
// Wraps navigator.geolocation.watchPosition into a clean state object the map
// can consume. The map draws a blue dot, an accuracy circle and a heading cone
// from this; the tracking module owns the sensor, the map owns the rendering.
//
// WHAT GOOGLE MAPS DOES THAT WE CANNOT. Google's Fused Location Provider runs
// on Android's system service and fuses GPS, Wi-Fi RTT, cell, barometer and
// inertial sensors with a Kalman filter. A web app sees only the RESULT of
// that fusion, via the browser's Geolocation API — which on Android IS the
// Fused Location Provider. So the sensor fusion is already happening; we are
// reading its output.
//
// WHAT WE ADD THAT THE BUILT-IN GeolocateControl DOES NOT:
//   - Compass heading from the magnetometer (deviceHeading.ts), shown even
//     when stationary. watchPosition's coords.heading is course-over-ground:
//     it is NaN at speed zero, which is exactly when you most want a compass.
//   - Accuracy-level labelling ("High" / "Medium" / "Low"), matching Google
//     Maps' calibration feedback so the user knows how much to trust the dot.
//   - A locate → track toggle: first tap centres the map, second tap enables
//     continuous tracking, third tap disables it.
//   - Works with the existing FurlPay map controls rather than adding
//     MapLibre's own UI that does not match the design.
// ---------------------------------------------------------------------------

import { requestOrientationPermission, watchHeading, type HeadingState } from "./deviceHeading";

export interface UserLocation {
  latitude: number;
  longitude: number;
  /** Accuracy radius in metres (95% confidence). */
  accuracy: number;
  /** Heading from compass, degrees CW from True North. null on desktop. */
  heading: number | null;
  /** Course-over-ground from GPS. Only meaningful while moving. */
  courseHeading: number | null;
  /** Speed in m/s from GPS. null when stationary or unavailable. */
  speed: number | null;
  /** "high" ≤ 15m, "medium" ≤ 50m, "low" > 50m — Google Maps' own buckets. */
  accuracyLevel: "high" | "medium" | "low";
  /** Unix timestamp of the position fix. */
  timestamp: number;
}

export type LocationCallback = (loc: UserLocation) => void;
export type ErrorCallback = (msg: string) => void;

/**
 * Classify accuracy the same way Google Maps does in its calibration screen.
 *
 * The thresholds are from Google's own help documentation:
 *   ≤ 15m  → High (strong GPS lock or good Wi-Fi)
 *   ≤ 50m  → Medium (GPS or cell tower triangulation)
 *   > 50m  → Low  (IP geolocation or poor signal)
 */
function classifyAccuracy(meters: number): "high" | "medium" | "low" {
  if (meters <= 15) return "high";
  if (meters <= 50) return "medium";
  return "low";
}

export interface LocationTracker {
  /** Stop tracking and release all sensors. */
  stop: () => void;
}

/**
 * Start continuous location tracking.
 *
 * Calls `onLocation` with every position update and compass heading change.
 * Calls `onError` if the browser denies or cannot determine location.
 *
 * Returns a tracker with a `stop()` method to shut everything down — call it
 * on unmount, or the GPS and magnetometer keep running and eating battery.
 */
export function startTracking(
  onLocation: LocationCallback,
  onError: ErrorCallback
): LocationTracker {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    onError("This browser cannot report a location");
    return { stop: () => {} };
  }

  let lastPosition: GeolocationPosition | null = null;
  let lastCompassHeading: number | null = null;
  let stopped = false;

  const emit = () => {
    if (stopped || !lastPosition) return;
    const c = lastPosition.coords;
    const loc: UserLocation = {
      latitude: c.latitude,
      longitude: c.longitude,
      accuracy: c.accuracy,
      heading: lastCompassHeading,
      courseHeading:
        c.heading !== null && Number.isFinite(c.heading) && c.speed !== null && c.speed > 0.5
          ? c.heading
          : null,
      speed: c.speed !== null && Number.isFinite(c.speed) ? c.speed : null,
      accuracyLevel: classifyAccuracy(c.accuracy),
      timestamp: lastPosition.timestamp,
    };
    onLocation(loc);
  };

  // GPS / fused location.
  const watchId = navigator.geolocation.watchPosition(
    (pos) => {
      lastPosition = pos;
      emit();
    },
    (err) => {
      if (stopped) return;
      onError(
        err.code === err.PERMISSION_DENIED
          ? "Location permission denied"
          : err.code === err.TIMEOUT
            ? "Timed out finding your location"
            : "Could not determine your location"
      );
    },
    {
      // enableHighAccuracy: true asks the OS for GPS, not just Wi-Fi/cell.
      // On Android this triggers the Fused Location Provider's high-accuracy
      // mode, which is the same thing Google Maps uses.
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 2000,
    }
  );

  // Compass heading — fires even when stationary.
  let stopHeading: (() => void) | null = null;

  void requestOrientationPermission().then((granted) => {
    if (stopped || !granted) return;
    stopHeading = watchHeading((state: HeadingState) => {
      lastCompassHeading = state.heading;
      emit();
    });
  });

  return {
    stop: () => {
      stopped = true;
      navigator.geolocation.clearWatch(watchId);
      stopHeading?.();
    },
  };
}
