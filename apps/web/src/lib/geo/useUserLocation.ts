"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { asCoordinate, type Coordinate } from "./coordinates";

// ---------------------------------------------------------------------------
// One-shot user location for discovery.
//
// ── ONE-SHOT, NOT watchPosition ────────────────────────────────────────────
// "Find hotels near me" is a question asked once. A continuous watch would
// keep the GPS awake, drain the battery, re-render on every jitter of the fix,
// and collect a movement trail for a feature that needs a single point. There
// is no product requirement here that a stream satisfies and a snapshot does
// not, so this takes a snapshot.
//
// ── WHY THE PERMISSIONS API MATTERS ────────────────────────────────────────
// navigator.permissions.query({name:"geolocation"}) reports granted / denied /
// prompt WITHOUT triggering a prompt. That is what lets the control render as
// "Location is off" for someone who already said no, instead of firing another
// request at a browser that will reject it silently — and it is what keeps us
// from nagging.
//
// ── PRIVACY ────────────────────────────────────────────────────────────────
// The coordinate is held in component state and nothing else: not written to
// storage, not put in the URL, not attached to analytics, and never logged.
// The one place it leaves the browser is the bounding box of a nearby query,
// which is a rounded box rather than the point itself.
// ---------------------------------------------------------------------------

export type LocationStatus =
  | "idle"
  | "requesting"
  | "available"
  /** The reader said no, or a Permissions-Policy blocks it. Do not re-ask. */
  | "denied"
  /** The device could not produce a fix — indoors, radio off, hardware. */
  | "unavailable"
  /** No Geolocation API, or the page is not in a secure context. */
  | "unsupported"
  | "timeout";

export interface UserLocationState {
  status: LocationStatus;
  coordinate: Coordinate | null;
  /** Metres of uncertainty the browser reported, when it did. */
  accuracy: number | null;
  /** True once the reader has been asked at least once this session. */
  asked: boolean;
}

const TIMEOUT_MS = 12_000;

/** Geolocation is a secure-context API; over plain http it does not exist. */
function supported(): boolean {
  return typeof navigator !== "undefined" && "geolocation" in navigator;
}

export function useUserLocation() {
  const [state, setState] = useState<UserLocationState>({
    status: "idle",
    coordinate: null,
    accuracy: null,
    asked: false,
  });

  // Guards against a second request while one is in flight — a double tap
  // otherwise stacks two prompts on some browsers.
  const inFlight = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Reflect an already-denied permission without asking. Wrapped because
  // Permissions is absent in older Safari and throws for unknown names.
  useEffect(() => {
    if (!supported() || !navigator.permissions?.query) return;
    let cancelled = false;
    navigator.permissions
      .query({ name: "geolocation" as PermissionName })
      .then((res) => {
        if (cancelled || !mounted.current) return;
        if (res.state === "denied") {
          setState((s) => (s.status === "idle" ? { ...s, status: "denied" } : s));
        }
      })
      .catch(() => {
        // No Permissions API for geolocation here. Not an error — the request
        // path still works, we just cannot pre-empt a refusal.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const request = useCallback(() => {
    if (inFlight.current) return;

    if (!supported()) {
      setState((s) => ({ ...s, status: "unsupported", asked: true }));
      return;
    }

    inFlight.current = true;
    setState((s) => ({ ...s, status: "requesting", asked: true }));

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        inFlight.current = false;
        if (!mounted.current) return;
        // The browser can hand back NaN or a nonsense fix. Validating here
        // means no surface downstream has to wonder.
        const coordinate = asCoordinate(pos.coords.latitude, pos.coords.longitude);
        if (!coordinate) {
          setState((s) => ({ ...s, status: "unavailable", coordinate: null }));
          return;
        }
        setState({
          status: "available",
          coordinate,
          accuracy: Number.isFinite(pos.coords.accuracy) ? pos.coords.accuracy : null,
          asked: true,
        });
      },
      (err) => {
        inFlight.current = false;
        if (!mounted.current) return;
        // Never log the error object: on some browsers it carries the position
        // that failed a policy check, and this is the one path where a
        // coordinate could reach a log.
        const status: LocationStatus =
          err.code === err.PERMISSION_DENIED
            ? "denied"
            : err.code === err.TIMEOUT
              ? "timeout"
              : "unavailable";
        setState((s) => ({ ...s, status, coordinate: null, accuracy: null }));
      },
      {
        enableHighAccuracy: false, // city-scale discovery; a coarse fix is faster and less invasive
        timeout: TIMEOUT_MS,
        maximumAge: 60_000, // a minute-old fix is fine for "what is near me"
      }
    );
  }, []);

  /** Back to idle so a control can offer "Try again" after a failure. */
  const reset = useCallback(() => {
    setState((s) => ({ ...s, status: "idle", coordinate: null, accuracy: null }));
  }, []);

  return { ...state, request, reset, supported: supported() };
}

/** Human-readable recovery copy. Never blames the reader for our failures. */
export function locationMessage(status: LocationStatus): { title: string; body: string } | null {
  switch (status) {
    case "denied":
      return {
        title: "Location is off",
        body: "Allow location in your browser settings to find stays near you, or search a destination instead.",
      };
    case "unavailable":
      return {
        title: "Couldn't determine your location",
        body: "Your device didn't return a position. This is common indoors.",
      };
    case "timeout":
      return {
        title: "Location took too long",
        body: "Your device didn't respond in time.",
      };
    case "unsupported":
      return {
        title: "Location isn't available here",
        body: "This browser doesn't offer location, or the page isn't on a secure connection.",
      };
    default:
      return null;
  }
}
