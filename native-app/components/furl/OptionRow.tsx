import React from "react";
import { Pressable, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles, useTheme } from "@/lib/design";

/**
 * A single-choice row inside a settings group.
 *
 * `accessibilityRole="radio"` plus `state.checked` is what makes a group of
 * these announce as "Light, radio button, 2 of 3, selected" rather than three
 * unrelated buttons. The checkmark is the visual half of the same information.
 */
export function OptionRow({
  label,
  sublabel,
  icon,
  selected,
  onPress,
  divider,
  disabled,
}: {
  label: string;
  sublabel?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  selected: boolean;
  onPress: () => void;
  divider?: boolean;
  disabled?: boolean;
}) {
  const t = useTheme();
  const s = useStyles();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled: !!disabled }}
      accessibilityLabel={sublabel ? `${label}, ${sublabel}` : label}
      style={({ pressed }) => [
        s.row,
        divider && s.divider,
        { minHeight: t.touchTarget.min, opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
      ]}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={t.component.icon.lg}
          color={selected ? t.colors.primaryText : t.colors.textDim}
        />
      ) : null}
      <View style={s.body}>
        <Text style={t.type("body")}>{label}</Text>
        {sublabel ? (
          <Text style={[t.type("caption"), { color: t.colors.textDim }]}>{sublabel}</Text>
        ) : null}
      </View>
      {selected ? (
        <Ionicons name="checkmark" size={t.component.icon.lg} color={t.colors.primaryText} />
      ) : null}
    </Pressable>
  );
}

const useStyles = makeStyles((t) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: t.spacing.sm,
    paddingHorizontal: t.spacing.md,
    paddingVertical: t.spacing.sm,
  },
  divider: {
    borderBottomWidth: 1,
    borderBottomColor: t.colors.divider,
  },
  body: { flex: 1, gap: 2 },
}));
