import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { makeStyles, useTheme } from "@/lib/design";
import { haptic } from "@/lib/haptics";

export interface FurlTab {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  iconActive?: keyof typeof Ionicons.glyphMap;
  /** Unread/pending count. `0` renders nothing. */
  badge?: number;
}

/**
 * Bottom navigation.
 *
 * Adapts to the size class rather than stretching: on a tablet or an unfolded
 * foldable the same tabs render as a left-hand RAIL, because a 900dp-wide bar
 * with five 48dp targets in the middle is a phone UI that has been inflated
 * rather than laid out.
 */
export function FurlTabBar({
  tabs,
  active,
  onChange,
}: {
  tabs: FurlTab[];
  active: string;
  onChange: (key: string) => void;
}) {
  const t = useTheme();
  const s = useStyles();
  const insets = useSafeAreaInsets();
  const rail = t.sizeClass !== "compact";

  return (
    <View
      accessibilityRole="tablist"
      style={[
        rail ? s.rail : s.bar,
        !rail && { paddingBottom: insets.bottom },
        rail && { paddingTop: insets.top },
      ]}
    >
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        const color = isActive ? t.colors.primaryText : t.colors.textDim;
        const badge = tab.badge && tab.badge > 0 ? tab.badge : null;
        return (
          <Pressable
            key={tab.key}
            onPress={() => {
              if (isActive) return;
              haptic.select();
              onChange(tab.key);
            }}
            accessibilityRole="tab"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={
              badge ? `${tab.label}, ${badge} unread` : tab.label
            }
            style={[s.tab, rail && s.railTab, { minHeight: t.touchTarget.min }]}
          >
            <View>
              <Ionicons
                name={isActive ? (tab.iconActive ?? tab.icon) : tab.icon}
                size={t.component.icon.lg}
                color={color}
              />
              {badge ? (
                <View style={s.badge}>
                  <Text style={s.badgeText} numberOfLines={1}>
                    {badge > 99 ? "99+" : badge}
                  </Text>
                </View>
              ) : null}
            </View>
            <Text style={[t.type("caption"), { color }]} numberOfLines={1}>
              {tab.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const useStyles = makeStyles((t) => ({
  bar: {
    flexDirection: "row",
    backgroundColor: t.colors.bg,
    borderTopWidth: 1,
    borderTopColor: t.colors.border,
  },
  rail: {
    width: 88,
    backgroundColor: t.colors.bg,
    borderRightWidth: 1,
    borderRightColor: t.colors.border,
    gap: t.spacing.sm,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
    paddingVertical: t.spacing.sm,
  },
  railTab: { flex: 0, paddingVertical: t.spacing.md },
  badge: {
    position: "absolute",
    top: -4,
    right: -8,
    minWidth: 16,
    height: 16,
    paddingHorizontal: 4,
    borderRadius: t.radius.pill,
    backgroundColor: t.colors.accent,
    alignItems: "center",
    justifyContent: "center",
  },
  badgeText: { color: t.colors.onAccent, fontSize: 10, fontWeight: "700" },
}));
