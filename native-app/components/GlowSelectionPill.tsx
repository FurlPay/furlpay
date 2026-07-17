import React, { useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  Animated,
  Image,
  type ImageSourcePropType,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Ionicons } from "@expo/vector-icons";
import { colors, glow, radius, spacing, type } from "@/lib/theme";

// ---------------------------------------------------------------------------
// Signature FurlPay "selected" pill. Use SPARINGLY — only where a selection
// genuinely benefits from emphasis (asset/category/network/payment choice), so
// the effect stays rare and therefore premium.
//
// Selected:   a 1.5px luminous gradient border (amber → silver → mint) around a
//             dark translucent interior, plus a soft few-pixel outer glow.
// Unselected: dark charcoal surface with a subtle neutral border, no glow.
//
// Gradient border is drawn with expo-linear-gradient (already a dependency) via
// the padding technique: an outer gradient view padded 1.5px wraps an inner
// dark disc. The subtle scale/fade transition uses RN Animated (reanimated is
// not installed) and is skipped when the OS reduce-motion setting is on.
// ---------------------------------------------------------------------------

export function GlowSelectionPill({
  label,
  icon,
  image,
  selected,
  disabled,
  onPress,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  image?: ImageSourcePropType;
  selected: boolean;
  disabled?: boolean;
  onPress?: () => void;
}) {
  const anim = useRef(new Animated.Value(selected ? 1 : 0)).current;
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    let active = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => active && setReduceMotion(v));
    const sub = AccessibilityInfo.addEventListener("reduceMotionChanged", setReduceMotion);
    return () => {
      active = false;
      sub.remove();
    };
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      anim.setValue(selected ? 1 : 0);
      return;
    }
    Animated.timing(anim, {
      toValue: selected ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [selected, reduceMotion, anim]);

  // 0.98 → 1.0 scale on select; the glow layer fades in with the same driver.
  const scale = anim.interpolate({ inputRange: [0, 1], outputRange: [0.98, 1] });

  const content = (
    <View style={styles.inner}>
      {image ? (
        <Image source={image} style={styles.thumb} />
      ) : icon ? (
        <Ionicons name={icon} size={16} color={selected ? colors.neon : colors.textDim} />
      ) : null}
      <Text
        style={[type.body, { fontSize: 14, fontWeight: "600", color: selected ? colors.text : colors.textDim }]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  );

  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: !!disabled }}
      accessibilityLabel={label}
      style={{ opacity: disabled ? 0.45 : 1 }}
    >
      <Animated.View style={{ transform: [{ scale }] }}>
        {selected ? (
          // Soft outer glow lives on this wrapper; the gradient border is the
          // padded LinearGradient; the interior is the dark inner disc.
          <Animated.View style={[styles.glowWrap, { opacity: anim }]}>
            <LinearGradient
              colors={glow.gradient as unknown as [string, string, string]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.gradientBorder}
            >
              <View style={styles.selectedSurface}>{content}</View>
            </LinearGradient>
          </Animated.View>
        ) : (
          <View style={styles.unselected}>{content}</View>
        )}
      </Animated.View>
    </Pressable>
  );
}

const PAD_H = 16;
const PAD_V = 9;

const styles = StyleSheet.create({
  inner: { flexDirection: "row", alignItems: "center", gap: 8 },
  thumb: { width: 18, height: 18, borderRadius: 9 },
  glowWrap: {
    borderRadius: radius.pill,
    // Soft, small glow — not neon/gaming. Android renders elevation; the shadow*
    // props cover iOS.
    shadowColor: glow.glowColor,
    shadowOpacity: 0.5,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 0 },
    elevation: 4,
  },
  gradientBorder: {
    borderRadius: radius.pill,
    padding: 1.5, // the visible border thickness
  },
  selectedSurface: {
    borderRadius: radius.pill,
    backgroundColor: "rgba(13,13,13,0.92)", // dark translucent interior
    paddingHorizontal: PAD_H,
    paddingVertical: PAD_V,
  },
  unselected: {
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderColor: colors.border,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: PAD_H,
    paddingVertical: PAD_V + 1.5, // match selected total height (border adds 1.5)
  },
});
