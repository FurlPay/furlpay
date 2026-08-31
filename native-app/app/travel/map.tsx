import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { Stack, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Haptics from "expo-haptics";
import {
  Camera,
  MapView,
  type CameraRef,
  type MapViewRef,
} from "@maplibre/maplibre-react-native";
import { colors, radius, spacing, type } from "@/lib/theme";
import { API_BASE } from "@/lib/api";
import { luxuryMapStyle, MAP_PALETTE } from "@/lib/hotelMapStyle";
import {
  fetchMapPoints,
  FAMILIES,
  LUXURY_CATEGORIES,
  type ClusterMember,
  type MapCluster,
  type MapFilter,
  type MapPoint,
  type MapResponse,
  type PropertyFamily,
} from "@/lib/hotelMap";
import { ClusterMarker, PropertyMarker } from "@/components/trips/MapMarkers";
import { ClusterSheet, PropertySheet } from "@/components/trips/MapPreviewSheet";

// ---------------------------------------------------------------------------
// The luxury hotel map, on a phone.
//
// SAME DATA, SAME PALETTE, SAME CLAIMS as furlpay.com/hotels/map. It calls the
// same /api/travel/hotels/map endpoint — which already does the clustering, the
// OpenStreetMap merge and the honest counting — and paints the same OpenFreeMap
// tiles through the same recolouring, so the phone and the browser show one
// map rather than two that resemble each other.
//
// WHAT CHANGES FOR TOUCH. The web's hover card is anchored beside a marker and
// stays open while the cursor travels into it; neither idea survives on a
// touch screen, where a finger is either down or it is not. Tapping opens a
// bottom sheet instead. Everything else — what a marker's size means, what its
// colour means, and what the status bar is allowed to claim — is unchanged,
// because those are properties of the data rather than of the pointer.
// ---------------------------------------------------------------------------

/** Long enough that a flick issues one request, short enough to feel live. */
const DEBOUNCE_MS = 350;

/** A viewport, named rather than positional — see schedule() for why. */
type Bounds = { west: number; south: number; east: number; north: number };
const DEFAULT_CENTER: [number, number] = [20, 25];
const DEFAULT_ZOOM = 2.5;

export default function HotelMapScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const mapRef = useRef<MapViewRef>(null);
  const cameraRef = useRef<CameraRef>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<AbortController | null>(null);

  const [styleJson, setStyleJson] = useState<string | null>(null);
  const [data, setData] = useState<MapResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [selectedPoint, setSelectedPoint] = useState<MapPoint | null>(null);
  const [selectedCluster, setSelectedCluster] = useState<MapCluster | null>(null);

  // --- filters --------------------------------------------------------------
  const [families, setFamilies] = useState<PropertyFamily[]>([]);
  const [categories, setCategories] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);

  const filter: MapFilter = useMemo(
    () => ({ families, categories, query: query.trim() || undefined }),
    [families, categories, query]
  );
  // Read inside load() without making it a dependency, so the map's own
  // callbacks stay stable and are not re-registered on every keystroke.
  const filterRef = useRef(filter);
  filterRef.current = filter;

  // The recoloured style is fetched once. Until it arrives the map is not
  // mounted at all — mounting with a URL and swapping later makes MapLibre
  // reload every tile, which is a visible flash of the wrong cartography.
  useEffect(() => {
    const ac = new AbortController();
    void luxuryMapStyle(ac.signal).then((s) => setStyleJson(s));
    return () => ac.abort();
  }, []);

  /**
   * Fetch the points for a viewport.
   *
   * Takes the bounds rather than reading them back off the map. The region
   * event already carries `bounds` and `zoom`, so asking the native side for
   * them again is two extra bridge round trips per pan for numbers we were just
   * handed — and they can disagree, because the camera keeps moving while the
   * promises are in flight.
   */
  const load = useCallback(async (bounds: Bounds, zoom: number) => {
    inflight.current?.abort();
    const ac = new AbortController();
    inflight.current = ac;
    setLoading(true);

    const { west, south, east, north } = bounds;

    try {
      const res = await fetchMapPoints(
        { minLng: west, minLat: south, maxLng: east, maxLat: north },
        zoom,
        filterRef.current,
        ac.signal
      );
      if (ac.signal.aborted) return;
      setData(res);
      setError(null);
    } catch (e) {
      // A superseded request is not a failure. api() throws AbortedError for
      // that case, and showing it would put an error banner on screen every
      // time somebody flicks the map.
      if (ac.signal.aborted || (e as Error).name === "AbortedError") return;
      setError("Could not load hotels for this area");
    } finally {
      if (inflight.current === ac) setLoading(false);
    }
  }, []);

  /** The last viewport the map reported, so a filter change can re-ask it. */
  const viewport = useRef<{ bounds: Bounds; zoom: number } | null>(null);

  /**
   * Read the viewport off the map and schedule a fetch.
   *
   * v10 gives no bounds in the region event, so they are read back through the
   * bridge. getVisibleBounds() answers [northEast, southWest] — the order is
   * easy to get backwards, and a flipped box is a valid-looking request for the
   * wrong part of the earth, so it is destructured by name.
   */
  const schedule = useCallback(() => {
    const map = mapRef.current;
    if (!map) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void (async () => {
        const m = mapRef.current;
        if (!m) return;
        const [[neLng, neLat], [swLng, swLat]] = await m.getVisibleBounds();
        const zoom = await m.getZoom();
        const bounds: Bounds = {
          west: Math.min(swLng, neLng),
          south: Math.min(swLat, neLat),
          east: Math.max(swLng, neLng),
          north: Math.max(swLat, neLat),
        };
        viewport.current = { bounds, zoom };
        void load(bounds, zoom);
      })();
    }, DEBOUNCE_MS);
  }, [load]);

  // A filter change re-asks the SAME viewport, on the same debounce as a pan —
  // which is why the last one is kept. Without it, a filter change would not
  // take effect until the camera happened to move.
  useEffect(() => {
    const v = viewport.current;
    if (!v) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void load(v.bounds, v.zoom), DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [families, categories, query, load]);

  useEffect(() => () => inflight.current?.abort(), []);

  const tap = useCallback(() => {
    // A marker is a small target; the tick confirms the tap landed on it rather
    // than on the map behind it.
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  }, []);

  const onCluster = useCallback(
    (c: MapCluster) => {
      tap();
      setSelectedPoint(null);
      setSelectedCluster(c);
    },
    [tap]
  );

  const onPoint = useCallback(
    (p: MapPoint) => {
      tap();
      setSelectedCluster(null);
      setSelectedPoint(p);
    },
    [tap]
  );

  /** Fit exactly the properties a cluster counted — the same guarantee the web
   *  makes, which is what keeps the number checkable. */
  const zoomToCluster = useCallback((c: MapCluster) => {
    setSelectedCluster(null);
    cameraRef.current?.fitBounds(
      // fitBounds takes NORTH-EAST first, then south-west.
      [c.bounds.maxLng, c.bounds.maxLat],
      [c.bounds.minLng, c.bounds.minLat],
      // [top, right, bottom, left]. Asymmetric on purpose: the floating header
      // sits over the top of the map and the status pill over the bottom, so an
      // even inset would fit the cluster underneath the chrome describing it.
      [140, 60, 120, 60],
      650
    );
  }, []);

  const openProperty = useCallback(
    (p: MapPoint | ClusterMember) => {
      setSelectedPoint(null);
      setSelectedCluster(null);
      router.push({
        pathname: "/travel/property/[id]",
        params: { id: p.id, city: p.city ?? "" },
      });
    },
    [router]
  );

  const toggleFamily = (f: PropertyFamily) =>
    setFamilies((prev) => (prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]));
  const toggleCategory = (id: string) =>
    setCategories((prev) => (prev.includes(id) ? prev.filter((c) => c !== id) : [...prev, id]));

  const status = useMemo(() => statusLine(data, error, loading), [data, error, loading]);

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ title: "Hotel map", headerShown: false }} />

      {styleJson ? (
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          mapStyle={styleJson}
          // OpenStreetMap's licence requires visible credit and it is not ours
          // to remove, so MapLibre's own attribution control stays on. The logo
          // goes: that is branding, not a licence condition.
          attributionEnabled
          logoEnabled={false}
          compassEnabled={false}
          onDidFinishLoadingMap={schedule}
          onRegionDidChange={schedule}
        >
          <Camera
            ref={cameraRef}
            defaultSettings={{ centerCoordinate: DEFAULT_CENTER, zoomLevel: DEFAULT_ZOOM }}
          />

          {data?.clusters.map((c) => (
            <ClusterMarker key={c.id} cluster={c} onPress={onCluster} />
          ))}
          {data?.points.map((p) => (
            <PropertyMarker
              key={p.id}
              point={p}
              selected={selectedPoint?.id === p.id}
              onPress={onPoint}
            />
          ))}
        </MapView>
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.styleLoading]}>
          <ActivityIndicator color={colors.neon} />
        </View>
      )}

      {/* --- floating header ------------------------------------------------ */}
      <View style={[styles.header, { paddingTop: insets.top + spacing.sm }]}>
        <View style={styles.searchRow}>
          <Pressable
            onPress={() => router.back()}
            hitSlop={10}
            style={styles.iconButton}
            accessibilityRole="button"
            accessibilityLabel="Back"
          >
            <Ionicons name="chevron-back" size={20} color={colors.text} />
          </Pressable>

          <View style={styles.search}>
            <Ionicons name="search" size={16} color={colors.textFaint} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Search hotels, cities…"
              placeholderTextColor={colors.textFaint}
              style={styles.searchInput}
              returnKeyType="search"
              accessibilityLabel="Search hotels and cities"
            />
            {query.length > 0 && (
              <Pressable
                onPress={() => setQuery("")}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel="Clear search"
              >
                <Ionicons name="close-circle" size={16} color={colors.textFaint} />
              </Pressable>
            )}
          </View>

          <Pressable
            onPress={() => setFiltersOpen((v) => !v)}
            hitSlop={10}
            style={[styles.iconButton, (filtersOpen || categories.length > 0) && styles.iconButtonOn]}
            accessibilityRole="button"
            accessibilityLabel="Filters"
            accessibilityState={{ expanded: filtersOpen }}
          >
            <Ionicons
              name="options-outline"
              size={19}
              color={categories.length > 0 ? colors.onNeon : colors.text}
            />
          </Pressable>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.pillRow}
        >
          {FAMILIES.map((f) => {
            const on = families.includes(f.id);
            return (
              <Pressable
                key={f.id}
                onPress={() => toggleFamily(f.id)}
                style={[styles.pill, on && styles.pillOn]}
                accessibilityRole="button"
                accessibilityState={{ selected: on }}
                accessibilityLabel={f.label}
              >
                <Ionicons
                  name={f.icon as React.ComponentProps<typeof Ionicons>["name"]}
                  size={13}
                  color={on ? colors.onNeon : colors.textDim}
                />
                <Text style={[styles.pillText, on && styles.pillTextOn]}>{f.label}</Text>
              </Pressable>
            );
          })}
        </ScrollView>

        {filtersOpen && (
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.pillRow}
          >
            {LUXURY_CATEGORIES.map((c) => {
              const on = categories.includes(c.id);
              return (
                <Pressable
                  key={c.id}
                  onPress={() => toggleCategory(c.id)}
                  style={[styles.pill, on && { backgroundColor: c.color, borderColor: c.color }]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: on }}
                  accessibilityLabel={c.label}
                >
                  <Text style={[styles.pillText, on && { color: "#FFFFFF" }]}>{c.label}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
      </View>

      {/* --- status ---------------------------------------------------------- */}
      <View style={[styles.statusWrap, { paddingBottom: insets.bottom + spacing.sm }]}>
        <View style={[styles.status, error ? styles.statusWarn : null]}>
          {loading ? (
            <ActivityIndicator size="small" color={colors.neon} />
          ) : (
            <Ionicons
              name={error ? "warning-outline" : "map-outline"}
              size={14}
              color={error ? "#FFFFFF" : colors.textDim}
            />
          )}
          <Text style={[styles.statusText, error ? styles.statusTextWarn : null]} numberOfLines={2}>
            {status}
          </Text>
        </View>
      </View>

      <ClusterSheet
        cluster={selectedCluster}
        apiBase={API_BASE}
        onClose={() => setSelectedCluster(null)}
        onZoomTo={zoomToCluster}
        onOpenProperty={openProperty}
      />
      <PropertySheet
        point={selectedPoint}
        apiBase={API_BASE}
        onClose={() => setSelectedPoint(null)}
        onOpen={openProperty}
      />
    </View>
  );
}

/**
 * What the map is allowed to say about itself.
 *
 * The counts stay SEPARATE, exactly as on the web: a viewport holding 8 curated
 * properties and 196 OpenStreetMap hotels is not "204 of 507", because those
 * are two different populations and that phrasing invites the wrong reading.
 */
function statusLine(
  data: MapResponse | null,
  error: string | null,
  loading: boolean
): string {
  if (error) return error;
  if (!data) return loading ? "Loading hotels…" : "Pan the map to load hotels";

  const { curatedInView, curatedClustered, osmInView, curatedMatchingWorldwide } = data.counts;
  const luxury = curatedInView + curatedClustered;
  const parts: string[] = [];

  parts.push(
    luxury === 0
      ? curatedMatchingWorldwide > 0
        ? `No luxury properties here — ${curatedMatchingWorldwide} elsewhere`
        : "No luxury properties match these filters"
      : `${luxury} luxury ${luxury === 1 ? "property" : "properties"}`
  );
  if (osmInView > 0) parts.push(`${osmInView} other hotels`);
  // A cap that does not announce itself reads as "this is everything".
  if (data.truncated > 0) parts.push(`${data.truncated} more — zoom in`);
  if (data.osmUnavailable) parts.push("OpenStreetMap unavailable");
  else if (data.osmFilteredOut) parts.push("Filters cover luxury properties only");

  return parts.join(" · ");
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: MAP_PALETTE.land },
  styleLoading: {
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: MAP_PALETTE.land,
  },
  header: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  searchRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  iconButton: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  iconButtonOn: { backgroundColor: colors.neon, borderColor: colors.neon },
  search: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    height: 40,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  searchInput: {
    flex: 1,
    color: colors.text,
    fontSize: 14,
    // Android centres a TextInput oddly without this; iOS ignores it.
    paddingVertical: Platform.OS === "android" ? 0 : 6,
  },
  pillRow: { gap: spacing.xs, paddingRight: spacing.md },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    paddingHorizontal: 11,
    paddingVertical: 7,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  pillOn: { backgroundColor: colors.neon, borderColor: colors.neon },
  pillText: { ...type.dim, color: colors.textDim, fontWeight: "600" },
  pillTextOn: { color: colors.onNeon },
  statusWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.md,
    alignItems: "center",
  },
  status: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    maxWidth: "100%",
    paddingHorizontal: spacing.md,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  statusWarn: { backgroundColor: "#B54708", borderColor: "#B54708" },
  statusText: { ...type.dim, color: colors.textDim, flexShrink: 1 },
  statusTextWarn: { color: "#FFFFFF" },
});
