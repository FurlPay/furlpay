import React, { useMemo, useState } from "react";
import {
  FlatList,
  Platform,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  View,
} from "react-native";
import * as Haptics from "expo-haptics";
import { colors, radius, spacing, type } from "@/lib/theme";
import { Field, Sheet } from "@/components/ui";

export interface Country {
  code: string;
  code2: string;
  name: string;
  region: "americas" | "europe" | "asia_pacific" | "middle_east" | "africa";
  documentTypes: string[];
}

const COUNTRIES: Country[] = [
  { code: "USA", code2: "US", name: "United States", region: "americas", documentTypes: ["Passport", "State ID"] },
  { code: "CAN", code2: "CA", name: "Canada", region: "americas", documentTypes: ["Passport", "Driving License"] },
  { code: "MEX", code2: "MX", name: "Mexico", region: "americas", documentTypes: ["Passport", "Voter ID"] },
  { code: "BRA", code2: "BR", name: "Brazil", region: "americas", documentTypes: ["Passport", "National ID"] },
  { code: "ARG", code2: "AR", name: "Argentina", region: "americas", documentTypes: ["Passport", "National ID"] },
  { code: "COL", code2: "CO", name: "Colombia", region: "americas", documentTypes: ["Passport", "National ID"] },

  { code: "GBR", code2: "GB", name: "United Kingdom", region: "europe", documentTypes: ["Passport", "Driving License"] },
  { code: "DEU", code2: "DE", name: "Germany", region: "europe", documentTypes: ["Passport", "National ID"] },
  { code: "FRA", code2: "FR", name: "France", region: "europe", documentTypes: ["Passport", "National ID"] },
  { code: "ITA", code2: "IT", name: "Italy", region: "europe", documentTypes: ["Passport", "National ID"] },
  { code: "ESP", code2: "ES", name: "Spain", region: "europe", documentTypes: ["Passport", "National ID"] },
  { code: "NLD", code2: "NL", name: "Netherlands", region: "europe", documentTypes: ["Passport", "National ID"] },
  { code: "POL", code2: "PL", name: "Poland", region: "europe", documentTypes: ["Passport", "National ID"] },
  { code: "SWE", code2: "SE", name: "Sweden", region: "europe", documentTypes: ["Passport", "National ID"] },
  { code: "CHE", code2: "CH", name: "Switzerland", region: "europe", documentTypes: ["Passport", "National ID"] },
  { code: "IRL", code2: "IE", name: "Ireland", region: "europe", documentTypes: ["Passport", "Passport Card"] },
  { code: "PRT", code2: "PT", name: "Portugal", region: "europe", documentTypes: ["Passport", "National ID"] },

  { code: "IND", code2: "IN", name: "India", region: "asia_pacific", documentTypes: ["Passport", "Aadhaar", "PAN"] },
  { code: "CHN", code2: "CN", name: "China", region: "asia_pacific", documentTypes: ["Passport", "National ID"] },
  { code: "JPN", code2: "JP", name: "Japan", region: "asia_pacific", documentTypes: ["Passport", "Driving License"] },
  { code: "KOR", code2: "KR", name: "South Korea", region: "asia_pacific", documentTypes: ["Passport", "National ID"] },
  { code: "AUS", code2: "AU", name: "Australia", region: "asia_pacific", documentTypes: ["Passport", "Driving License"] },
  { code: "NZL", code2: "NZ", name: "New Zealand", region: "asia_pacific", documentTypes: ["Passport", "Driving License"] },
  { code: "SGP", code2: "SG", name: "Singapore", region: "asia_pacific", documentTypes: ["Passport", "National ID"] },
  { code: "MYS", code2: "MY", name: "Malaysia", region: "asia_pacific", documentTypes: ["Passport", "MyKad"] },
  { code: "THA", code2: "TH", name: "Thailand", region: "asia_pacific", documentTypes: ["Passport", "National ID"] },
  { code: "PHL", code2: "PH", name: "Philippines", region: "asia_pacific", documentTypes: ["Passport", "Unified Multi-Purpose ID"] },
  { code: "IDN", code2: "ID", name: "Indonesia", region: "asia_pacific", documentTypes: ["Passport", "National ID"] },
  { code: "PAK", code2: "PK", name: "Pakistan", region: "asia_pacific", documentTypes: ["Passport", "National ID"] },
  { code: "BGD", code2: "BD", name: "Bangladesh", region: "asia_pacific", documentTypes: ["Passport", "National ID"] },
  { code: "TWN", code2: "TW", name: "Taiwan", region: "asia_pacific", documentTypes: ["Passport", "National ID"] },

  { code: "ARE", code2: "AE", name: "United Arab Emirates", region: "middle_east", documentTypes: ["Passport", "Emirates ID"] },
  { code: "SAU", code2: "SA", name: "Saudi Arabia", region: "middle_east", documentTypes: ["Passport", "National ID"] },
  { code: "TUR", code2: "TR", name: "Turkey", region: "middle_east", documentTypes: ["Passport", "National ID"] },
  { code: "ISR", code2: "IL", name: "Israel", region: "middle_east", documentTypes: ["Passport", "National ID"] },

  { code: "ZAF", code2: "ZA", name: "South Africa", region: "africa", documentTypes: ["Passport", "National ID"] },
  { code: "NGA", code2: "NG", name: "Nigeria", region: "africa", documentTypes: ["Passport", "National ID"] },
  { code: "KEN", code2: "KE", name: "Kenya", region: "africa", documentTypes: ["Passport", "National ID"] },
  { code: "EGY", code2: "EG", name: "Egypt", region: "africa", documentTypes: ["Passport", "National ID"] },
  { code: "GHA", code2: "GH", name: "Ghana", region: "africa", documentTypes: ["Passport", "National ID"] },
];

const REGION_LABELS: Record<Country["region"], string> = {
  americas: "Americas",
  europe: "Europe",
  asia_pacific: "Asia Pacific",
  middle_east: "Middle East",
  africa: "Africa",
};

const POPULAR_CODES = ["USA", "GBR", "IND", "CAN", "AUS", "DEU", "FRA", "JPN"];

interface Props {
  open: boolean;
  onClose: () => void;
  onSelect: (country: Country) => void;
}

export function CountryPicker({ open, onClose, onSelect }: Props) {
  const [query, setQuery] = useState("");

  const handleSelect = (country: Country) => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    onSelect(country);
  };

  const { sections, popular } = useMemo(() => {
    const q = query.trim().toLowerCase();
    
    // Filter logic
    const filtered = COUNTRIES.filter((c) => {
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || c.code.toLowerCase().includes(q) || c.code2.toLowerCase().includes(q);
    });

    // Group by region
    const grouped = filtered.reduce((acc, c) => {
      if (!acc[c.region]) acc[c.region] = [];
      acc[c.region].push(c);
      return acc;
    }, {} as Record<string, Country[]>);

    const sectionData = Object.entries(grouped)
      .map(([region, data]) => ({
        title: REGION_LABELS[region as Country["region"]],
        data,
      }))
      .sort((a, b) => a.title.localeCompare(b.title));

    // Popular countries
    const pop = COUNTRIES.filter((c) => POPULAR_CODES.includes(c.code))
      .sort((a, b) => POPULAR_CODES.indexOf(a.code) - POPULAR_CODES.indexOf(b.code));

    return { sections: sectionData, popular: pop };
  }, [query]);

  const renderCountry = ({ item }: { item: Country }) => (
    <Pressable
      onPress={() => handleSelect(item)}
      accessibilityRole="button"
      accessibilityLabel={`${item.name} (${item.code}). Supported documents: ${item.documentTypes.join(", ")}.`}
      style={({ pressed }) => [styles.countryRow, pressed && styles.countryRowPressed]}
    >
      <View style={styles.countryChip}>
        <Text style={styles.countryCode} allowFontScaling={false}>
          {item.code}
        </Text>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <Text style={styles.countryName}>{item.name}</Text>
        <Text style={styles.countryTypes} numberOfLines={1}>
          {item.documentTypes.join(" • ")}
        </Text>
      </View>
    </Pressable>
  );

  return (
    <Sheet open={open} title="Select Country" onClose={onClose}>
      <View style={styles.content}>
        <View style={styles.searchWrap}>
          <Field
            placeholder="Search countries or ISO code..."
            value={query}
            onChangeText={setQuery}
            autoCapitalize="none"
            autoCorrect={false}
            /* Was `clearButtonMode`, which is iOS-only — Android users had no
               way to clear this without holding backspace. */
            clearable
          />
        </View>

        {!query && (
          <View style={styles.popularWrap}>
            <Text style={[type.dim, styles.popularTitle]}>POPULAR</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.popularScroll}>
              {popular.map((c) => (
                <Pressable
                  key={c.code}
                  onPress={() => handleSelect(c)}
                  accessibilityRole="button"
                  accessibilityLabel={c.name}
                  style={({ pressed }) => [styles.popularPill, pressed && styles.pressedPill]}
                >
                  <View style={styles.countryChip}>
                    <Text style={styles.countryCode} allowFontScaling={false}>
                      {c.code}
                    </Text>
                  </View>
                  <Text style={styles.popularName}>{c.name}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        )}

        <View style={styles.listWrap}>
          {sections.map((section) => (
            <View key={section.title} style={styles.section}>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{section.title}</Text>
              </View>
              {section.data.map((item) => (
                <React.Fragment key={item.code}>
                  {renderCountry({ item })}
                </React.Fragment>
              ))}
            </View>
          ))}
          {sections.length === 0 && (
            <Text style={[type.dim, { textAlign: "center", marginTop: spacing.xl }]}>
              No countries found for "{query}"
            </Text>
          )}
        </View>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  searchWrap: { paddingHorizontal: spacing.sm },
  popularWrap: { marginTop: spacing.sm },
  popularTitle: { paddingHorizontal: spacing.sm, fontSize: 11, fontWeight: "700", letterSpacing: 0.5, marginBottom: spacing.sm },
  popularScroll: { paddingHorizontal: spacing.sm, gap: spacing.sm },
  popularPill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    paddingRight: 12,
    paddingLeft: 4,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
  },
  pressedPill: { opacity: 0.7 },
  popularName: { color: colors.text, fontSize: 13, fontWeight: "600" },
  listWrap: { paddingHorizontal: spacing.sm, paddingBottom: 100 },
  section: { marginBottom: spacing.md },
  sectionHeader: {
    backgroundColor: colors.surface,
    paddingVertical: 6,
    marginBottom: 4,
  },
  sectionTitle: { color: colors.textDim, fontSize: 11, fontWeight: "700", letterSpacing: 1, textTransform: "uppercase" },
  countryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  countryRowPressed: { opacity: 0.6 },
  countryChip: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: radius.sm,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    alignSelf: "flex-start",
  },
  countryCode: {
    color: colors.text,
    fontSize: 12,
    fontWeight: "800",
    letterSpacing: 1,
    includeFontPadding: false,
  },
  countryName: { color: colors.text, fontSize: 15, fontWeight: "600" },
  countryTypes: { color: colors.textFaint, fontSize: 13 },
});
