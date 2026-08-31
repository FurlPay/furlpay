import React from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing, type } from "@/lib/theme";
import { Sheet } from "@/components/ui";
import {
  categoryColor,
  categoryLabel,
  imageUriFor,
  type ClusterMember,
  type MapCluster,
  type MapPoint,
} from "@/lib/hotelMap";

// ---------------------------------------------------------------------------
// What a tapped marker opens.
//
// THE WEB'S HOVER CARD DOES NOT PORT. It is anchored beside a marker, flips at
// the viewport edges, and stays open while the cursor travels into it — three
// behaviours built entirely around a pointer that can rest somewhere without
// committing. A touch screen has no such state: a finger is either down or it
// is not. So the card becomes a sheet, tapping replaces hovering, and the
// grace-delay logic that makes the web card usable is simply not needed here.
//
// WHAT IS THE SAME is the content and its honesty. The family counts sum to the
// cluster's total because familyOf() partitions the taxonomy completely; the
// "confirmed" figure is how many positions Google actually agreed with; and
// there are no nightly prices, because Duffel is in test mode on this
// deployment and a sandbox rate rendered like a real one is indistinguishable
// from a lie.
// ---------------------------------------------------------------------------

const GOLD = "#F5B851";

/** Where a stored Commons photograph is served from. Same origin as the API. */
function originFrom(apiBase: string): string {
  return apiBase.replace(/\/api\/?$/, "");
}

function Stat({
  icon,
  value,
  label,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  value: number;
  label: string;
}) {
  return (
    <View style={styles.stat}>
      <Ionicons name={icon} size={17} color={colors.textDim} />
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

function PropertyTile({
  member,
  origin,
  onPress,
}: {
  member: ClusterMember;
  origin: string;
  onPress: () => void;
}) {
  const uri = imageUriFor(member, origin);
  const tint = categoryColor(member.categories);

  return (
    <Pressable
      style={styles.tile}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${member.name}, ${member.propertyType}${
        member.stars ? `, ${member.stars} star` : ""
      }`}
    >
      <View style={[styles.tileImage, { backgroundColor: `${tint}22` }]}>
        {uri ? (
          <Image source={{ uri }} style={styles.tileImage} resizeMode="cover" />
        ) : (
          <Ionicons name="business-outline" size={22} color={tint} />
        )}
      </View>
      <Text style={styles.tileName} numberOfLines={1}>
        {member.name}
      </Text>
      <View style={styles.tileMeta}>
        {member.stars ? (
          <>
            <Ionicons name="star" size={10} color={GOLD} />
            <Text style={styles.tileStars}>{member.stars}.0</Text>
          </>
        ) : null}
        <Text style={styles.tileType} numberOfLines={1}>
          {member.propertyType}
        </Text>
      </View>
      {/* Where the price would go on the reference design. It stays a position
          statement until a live Duffel key makes a real rate available. */}
      <Text style={styles.tilePrecision} numberOfLines={1}>
        {member.precision === "exact" ? "Position confirmed" : "Approximate position"}
      </Text>
    </Pressable>
  );
}

export function ClusterSheet({
  cluster,
  apiBase,
  onClose,
  onZoomTo,
  onOpenProperty,
}: {
  cluster: MapCluster | null;
  apiBase: string;
  onClose: () => void;
  onZoomTo: (c: MapCluster) => void;
  onOpenProperty: (m: ClusterMember) => void;
}) {
  const origin = originFrom(apiBase);
  const hero = cluster?.top.find((m) => imageUriFor(m, origin));
  const heroUri = hero ? imageUriFor(hero, origin) : undefined;

  return (
    <Sheet open={Boolean(cluster)} title={cluster?.label ?? ""} onClose={onClose}>
      {cluster ? (
        <View style={{ gap: spacing.md }}>
          <Text style={styles.sublabel}>{cluster.sublabel}</Text>

          <View style={styles.hero}>
            {heroUri ? (
              <Image source={{ uri: heroUri }} style={styles.heroImage} resizeMode="cover" />
            ) : (
              <View style={[styles.heroImage, styles.heroEmpty]}>
                <Text style={styles.heroEmptyText}>No photograph available</Text>
              </View>
            )}
          </View>

          {/* These three sum to the count — familyOf() is a complete partition,
              so the card's own arithmetic always adds up in front of the user. */}
          <View style={styles.stats}>
            <Stat icon="business-outline" value={cluster.families.hotels} label="Hotels" />
            <Stat icon="sunny-outline" value={cluster.families.resorts} label="Resorts" />
            <Stat icon="home-outline" value={cluster.families.villas} label="Villas" />
            <Stat icon="shield-checkmark-outline" value={cluster.confirmed} label="Confirmed" />
          </View>

          {cluster.top.length > 0 && (
            <View style={{ gap: spacing.sm }}>
              <View style={styles.rowBetween}>
                <Text style={styles.sectionTitle}>Top properties</Text>
                {cluster.count > cluster.top.length && (
                  <Pressable
                    onPress={() => onZoomTo(cluster)}
                    accessibilityRole="button"
                    accessibilityLabel={`Zoom to all ${cluster.count} properties`}
                  >
                    <Text style={styles.viewAll}>View all →</Text>
                  </Pressable>
                )}
              </View>
              <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                <View style={styles.tileRow}>
                  {cluster.top.map((m) => (
                    <PropertyTile
                      key={m.id}
                      member={m}
                      origin={origin}
                      onPress={() => onOpenProperty(m)}
                    />
                  ))}
                </View>
              </ScrollView>
            </View>
          )}
        </View>
      ) : null}
    </Sheet>
  );
}

export function PropertySheet({
  point,
  apiBase,
  onClose,
  onOpen,
}: {
  point: MapPoint | null;
  apiBase: string;
  onClose: () => void;
  onOpen: (p: MapPoint) => void;
}) {
  const origin = originFrom(apiBase);
  const uri = point ? imageUriFor(point, origin) : undefined;
  const place = point ? [point.city, point.country].filter(Boolean).join(", ") : "";

  return (
    <Sheet open={Boolean(point)} title={point?.name ?? ""} onClose={onClose}>
      {point ? (
        <View style={{ gap: spacing.md }}>
          {place ? <Text style={styles.sublabel}>{place}</Text> : null}

          <View style={styles.hero}>
            {uri ? (
              <Image source={{ uri }} style={styles.heroImage} resizeMode="cover" />
            ) : (
              <View style={[styles.heroImage, styles.heroEmpty]}>
                <Text style={styles.heroEmptyText}>No photograph available</Text>
              </View>
            )}
          </View>

          <View style={styles.chips}>
            {point.stars ? (
              <View style={[styles.chip, { backgroundColor: "rgba(245,184,81,0.16)" }]}>
                <Ionicons name="star" size={11} color={GOLD} />
                <Text style={[styles.chipText, { color: GOLD }]}>{point.stars}</Text>
              </View>
            ) : null}
            <View style={styles.chip}>
              <Text style={styles.chipText}>{point.hotelType}</Text>
            </View>
            {(point.categories ?? []).map((id) => {
              const label = categoryLabel(id);
              if (!label) return null;
              const tint = categoryColor([id]);
              return (
                <View key={id} style={[styles.chip, { backgroundColor: `${tint}26` }]}>
                  <Text style={[styles.chipText, { color: tint }]}>{label}</Text>
                </View>
              );
            })}
          </View>

          {/* Where the pin comes from, stated rather than implied. An
              approximate position is a real property whose exact building we
              could not confirm, and hiding that would make the two look alike. */}
          <Text style={styles.provenance}>
            {point.source === "osm"
              ? "From OpenStreetMap"
              : point.precision === "exact"
                ? `Position confirmed via Google${point.corroboratedByOsm ? " and OpenStreetMap" : ""}`
                : "Approximate position — not confirmed"}
          </Text>

          <Pressable
            style={styles.cta}
            onPress={() => onOpen(point)}
            accessibilityRole="button"
            accessibilityLabel={`Open ${point.name}`}
          >
            <Text style={styles.ctaText}>View property</Text>
            <Ionicons name="arrow-forward" size={16} color={colors.onNeon} />
          </Pressable>
        </View>
      ) : null}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  sublabel: { ...type.body, color: colors.textDim, marginTop: -spacing.xs },
  hero: { borderRadius: radius.md, overflow: "hidden" },
  heroImage: { width: "100%", height: 150, borderRadius: radius.md },
  heroEmpty: {
    backgroundColor: colors.surfaceRaised,
    alignItems: "center",
    justifyContent: "center",
  },
  heroEmptyText: { ...type.dim, color: colors.textFaint },
  stats: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  stat: { flex: 1, alignItems: "center", gap: 3 },
  statValue: { ...type.body, color: colors.text, fontWeight: "700" },
  statLabel: { ...type.dim, color: colors.textFaint },
  rowBetween: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  sectionTitle: { ...type.body, color: colors.text, fontWeight: "700" },
  viewAll: { ...type.dim, color: colors.neon, fontWeight: "600" },
  tileRow: { flexDirection: "row", gap: spacing.sm },
  tile: { width: 124, gap: 3 },
  tileImage: {
    width: 124,
    height: 92,
    borderRadius: radius.sm,
    alignItems: "center",
    justifyContent: "center",
  },
  tileName: { ...type.dim, color: colors.text, fontWeight: "600" },
  tileMeta: { flexDirection: "row", alignItems: "center", gap: 3 },
  tileStars: { ...type.dim, color: colors.text, fontWeight: "700" },
  tileType: { ...type.dim, color: colors.textDim, flexShrink: 1 },
  tilePrecision: { ...type.dim, color: colors.textFaint, fontSize: 10 },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  chipText: { ...type.dim, color: colors.textDim, fontWeight: "600" },
  provenance: { ...type.dim, color: colors.textFaint },
  cta: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    backgroundColor: colors.neon,
    borderRadius: radius.md,
    paddingVertical: 13,
  },
  ctaText: { ...type.body, color: colors.onNeon, fontWeight: "700" },
});
