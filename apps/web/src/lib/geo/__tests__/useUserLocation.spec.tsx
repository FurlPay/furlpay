// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { renderHook, act, waitFor, cleanup } from "@testing-library/react";
import { useUserLocation, locationMessage } from "../useUserLocation";

// Location is the feature with the most ways to go wrong that are not errors:
// a reader declines, a phone is indoors, a page is on http, a browser has no
// Permissions API. Each has to end somewhere useful. The failure this guards
// hardest against is a control stuck spinning forever, because that is what
// every one of these becomes if the callback is not handled.

const DUBAI = { latitude: 25.2048, longitude: 55.2708, accuracy: 40 };

type SuccessFn = (p: { coords: { latitude: number; longitude: number; accuracy: number } }) => void;
type ErrorFn = (e: { code: number; PERMISSION_DENIED: number; TIMEOUT: number; POSITION_UNAVAILABLE: number }) => void;

const CODES = { PERMISSION_DENIED: 1, TIMEOUT: 3, POSITION_UNAVAILABLE: 2 };

function mockGeolocation(impl: (ok: SuccessFn, fail: ErrorFn) => void) {
  const getCurrentPosition = vi.fn((ok: SuccessFn, fail: ErrorFn) => impl(ok, fail));
  Object.defineProperty(navigator, "geolocation", {
    value: { getCurrentPosition },
    configurable: true,
  });
  return getCurrentPosition;
}

function removeGeolocation() {
  // @ts-expect-error deliberately modelling a browser without the API
  delete navigator.geolocation;
}

function mockPermissions(state: PermissionState | null) {
  Object.defineProperty(navigator, "permissions", {
    value:
      state === null
        ? undefined
        : { query: vi.fn().mockResolvedValue({ state }) },
    configurable: true,
  });
}

beforeEach(() => mockPermissions(null));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("a successful fix", () => {
  it("moves idle → requesting → available and keeps the coordinate", async () => {
    mockGeolocation((ok) => ok({ coords: DUBAI }));
    const { result } = renderHook(() => useUserLocation());
    expect(result.current.status).toBe("idle");

    act(() => result.current.request());
    await waitFor(() => expect(result.current.status).toBe("available"));
    expect(result.current.coordinate).toEqual({ latitude: 25.2048, longitude: 55.2708 });
    expect(result.current.accuracy).toBe(40);
  });

  it("rejects a malformed fix rather than trusting the browser", async () => {
    // A coordinate reaching the UI as NaN would render "NaN km away" and put a
    // marker nowhere. Validation happens once, here.
    mockGeolocation((ok) => ok({ coords: { latitude: NaN, longitude: 55, accuracy: 10 } }));
    const { result } = renderHook(() => useUserLocation());
    act(() => result.current.request());
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    expect(result.current.coordinate).toBeNull();
  });

  it("rejects 0,0 from the browser too", async () => {
    mockGeolocation((ok) => ok({ coords: { latitude: 0, longitude: 0, accuracy: 10 } }));
    const { result } = renderHook(() => useUserLocation());
    act(() => result.current.request());
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
  });
});

describe("every failure ends somewhere, never spinning", () => {
  it("permission denied", async () => {
    mockGeolocation((_ok, fail) => fail({ code: 1, ...CODES }));
    const { result } = renderHook(() => useUserLocation());
    act(() => result.current.request());
    await waitFor(() => expect(result.current.status).toBe("denied"));
    expect(result.current.coordinate).toBeNull();
  });

  it("timeout", async () => {
    mockGeolocation((_ok, fail) => fail({ code: 3, ...CODES }));
    const { result } = renderHook(() => useUserLocation());
    act(() => result.current.request());
    await waitFor(() => expect(result.current.status).toBe("timeout"));
  });

  it("position unavailable", async () => {
    mockGeolocation((_ok, fail) => fail({ code: 2, ...CODES }));
    const { result } = renderHook(() => useUserLocation());
    act(() => result.current.request());
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
  });

  it("browser without the API", async () => {
    removeGeolocation();
    const { result } = renderHook(() => useUserLocation());
    expect(result.current.supported).toBe(false);
    act(() => result.current.request());
    await waitFor(() => expect(result.current.status).toBe("unsupported"));
  });

  it("no status is left as 'requesting' after any outcome", async () => {
    for (const code of [1, 2, 3]) {
      mockGeolocation((_ok, fail) => fail({ code, ...CODES }));
      const { result, unmount } = renderHook(() => useUserLocation());
      act(() => result.current.request());
      await waitFor(() => expect(result.current.status).not.toBe("requesting"));
      unmount();
    }
  });
});

describe("it does not nag", () => {
  it("reflects an existing denial without ever calling getCurrentPosition", async () => {
    // The Permissions API reports state WITHOUT prompting. Someone who already
    // said no sees "Location is off", not another request the browser will
    // silently refuse.
    mockPermissions("denied");
    const spy = mockGeolocation((ok) => ok({ coords: DUBAI }));
    const { result } = renderHook(() => useUserLocation());
    await waitFor(() => expect(result.current.status).toBe("denied"));
    expect(spy).not.toHaveBeenCalled();
  });

  it("ignores a Permissions API that throws for geolocation", async () => {
    // Older Safari throws on the unknown name. That is not an error state —
    // the request path still works, we just cannot pre-empt a refusal.
    Object.defineProperty(navigator, "permissions", {
      value: { query: vi.fn().mockRejectedValue(new Error("unsupported")) },
      configurable: true,
    });
    mockGeolocation((ok) => ok({ coords: DUBAI }));
    const { result } = renderHook(() => useUserLocation());
    act(() => result.current.request());
    await waitFor(() => expect(result.current.status).toBe("available"));
  });

  it("does not stack requests when tapped twice", async () => {
    let resolve: SuccessFn | null = null;
    const spy = mockGeolocation((ok) => {
      resolve = ok;
    });
    const { result } = renderHook(() => useUserLocation());
    act(() => result.current.request());
    act(() => result.current.request());
    expect(spy).toHaveBeenCalledTimes(1);
    act(() => resolve!({ coords: DUBAI }));
    await waitFor(() => expect(result.current.status).toBe("available"));
  });
});

describe("recovery copy", () => {
  it("offers a way forward for every failure", () => {
    for (const s of ["denied", "unavailable", "timeout", "unsupported"] as const) {
      const m = locationMessage(s);
      expect(m, s).not.toBeNull();
      expect(m!.title.length).toBeGreaterThan(0);
      expect(m!.body.length).toBeGreaterThan(0);
    }
  });

  it("says nothing for states that are not failures", () => {
    expect(locationMessage("idle")).toBeNull();
    expect(locationMessage("available")).toBeNull();
    expect(locationMessage("requesting")).toBeNull();
  });

  it("does not blame the reader for a device or server problem", () => {
    for (const s of ["unavailable", "timeout", "unsupported"] as const) {
      const body = locationMessage(s)!.body.toLowerCase();
      expect(body).not.toContain("you must");
      expect(body).not.toContain("you failed");
    }
  });

  it("reset returns to idle so a control can offer Try again", async () => {
    mockGeolocation((_ok, fail) => fail({ code: 2, ...CODES }));
    const { result } = renderHook(() => useUserLocation());
    act(() => result.current.request());
    await waitFor(() => expect(result.current.status).toBe("unavailable"));
    act(() => result.current.reset());
    expect(result.current.status).toBe("idle");
  });
});
