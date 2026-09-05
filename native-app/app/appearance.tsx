import React, { useCallback } from "react";
import { ScrollView, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { makeStyles, useTheme, type ThemeMode } from "@/lib/design";
import {
  LOCALES,
  LOCALE_NAMES,
  isLocalePinned,
  useI18n,
  type Locale,
} from "@/lib/i18n";
import { haptic } from "@/lib/haptics";
import { router } from "expo-router";
import { FurlCard, FurlScreen, FurlSectionHeader, FurlSecondaryButton } from "@/components/furl";
import { OptionRow } from "@/components/furl/OptionRow";

/**
 * Appearance & language.
 *
 * Both settings are DEVICE preferences, not account settings: they persist in
 * device_prefs and survive sign-out (see migration v6 in lib/db.ts). Somebody
 * who set the app to Hindi and light mode should not have to set it again
 * because they signed out.
 */
export default function AppearanceScreen() {
  const t = useTheme();
  const s = useStyles();
  const i18n = useI18n();

  const setMode = useCallback(
    (m: ThemeMode) => {
      haptic.select();
      t.setMode(m);
    },
    [t]
  );

  const setLang = useCallback((l: Locale | null) => {
    haptic.select();
    i18n.setLocale(l);
  }, [i18n]);

  const pinned = isLocalePinned();

  const MODES: { key: ThemeMode; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
    { key: "system", label: i18n.t("settings.themeSystem"), icon: "phone-portrait-outline" },
    { key: "light", label: i18n.t("settings.themeLight"), icon: "sunny-outline" },
    { key: "dark", label: i18n.t("settings.themeDark"), icon: "moon-outline" },
  ];

  return (
    <FurlScreen>
      <ScrollView contentContainerStyle={s.scroll}>
        <View>
          <FurlSectionHeader title={i18n.t("settings.theme")} />
          <FurlCard padded={false}>
            {MODES.map((m, i) => (
              <OptionRow
                key={m.key}
                icon={m.icon}
                label={m.label}
                selected={t.mode === m.key}
                onPress={() => setMode(m.key)}
                divider={i < MODES.length - 1}
              />
            ))}
          </FurlCard>
          {t.mode === "system" ? (
            <Text style={[t.type("caption"), s.note]}>
              {/* Tell the user what "system" resolved to right now, so the
                  setting is not opaque when the device is mid-schedule. */}
              {t.scheme === "dark" ? i18n.t("settings.themeDark") : i18n.t("settings.themeLight")}
            </Text>
          ) : null}
        </View>

        <View>
          <FurlSectionHeader title={i18n.t("settings.language")} />
          <FurlCard padded={false}>
            <OptionRow
              icon="globe-outline"
              label={i18n.t("settings.languageSystem")}
              selected={!pinned}
              onPress={() => setLang(null)}
              divider
            />
            {LOCALES.map((l, i) => (
              <OptionRow
                key={l}
                // The endonym only. A user who opened the app in a language
                // they cannot read still finds their own language by looking
                // for the script they recognize, which an English gloss would
                // not help with.
                label={LOCALE_NAMES[l]}
                selected={pinned && i18n.locale === l}
                onPress={() => setLang(l)}
                divider={i < LOCALES.length - 1}
              />
            ))}
          </FurlCard>
        </View>

        <View>
          <FurlSectionHeader title={i18n.t("settings.reduceMotion")} />
          <FurlCard>
            <Text style={[t.type("body"), { color: t.colors.textDim }]}>
              {i18n.t("settings.reduceMotionBody")}
            </Text>
            <Text style={[t.type("caption"), { color: t.colors.textFaint }]}>
              {/* Deliberately read-only: this mirrors the OS switch rather than
                  adding a second, competing one. Two sources of truth for
                  "should this animate" is how an app ends up animating at
                  somebody who asked it not to. */}
              {t.reduceMotion ? "On — following your device setting." : "Off — following your device setting."}
            </Text>
          </FurlCard>
        </View>

        {/* Every component in the library, rendered in the current theme,
            language and font scale. The fastest way to see a theming
            regression on a real device. */}
        <FurlSecondaryButton
          title={i18n.t("nav.designSystem")}
          onPress={() => router.push("/design-system")}
          icon="color-palette-outline"
        />
      </ScrollView>
    </FurlScreen>
  );
}

const useStyles = makeStyles((t) => ({
  scroll: { padding: t.spacing.md, gap: t.spacing.lg },
  note: { color: t.colors.textFaint, paddingTop: t.spacing.xs, paddingHorizontal: t.spacing.xs },
}));
