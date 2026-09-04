import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { Field } from "@/components/ui";
import { colors, spacing } from "@/lib/theme";

// ---------------------------------------------------------------------------
// Where a physical card gets posted.
//
// The field set and every bound below is `ShippingAddressSchema` in
// apps/web/src/lib/cardSchemas.ts, read directly rather than guessed — the
// order, reissue and shipping-change routes all validate against that one
// schema, so a form that disagrees with it fails at submit on all three.
//
// COUNTRY IS ISO-3166 ALPHA-2 AND THE SERVER WILL REJECT ANYTHING ELSE. Typing
// "United Kingdom" into a two-character field is the obvious mistake, so the
// input caps at two characters, uppercases as you type, and the hint says what
// it wants. A full country picker would be better still and is the honest next
// step; capping and labelling is what stops the 400 today.
// ---------------------------------------------------------------------------

export interface ShippingDraft {
  name: string;
  line1: string;
  line2: string;
  city: string;
  postcode: string;
  country: string;
}

export const EMPTY_SHIPPING: ShippingDraft = {
  name: "",
  line1: "",
  line2: "",
  city: "",
  postcode: "",
  country: "",
};

/** Mirrors the server's required fields and its length bounds exactly. */
export function isShippingComplete(s: ShippingDraft): boolean {
  return (
    s.name.trim().length >= 1 &&
    s.name.trim().length <= 80 &&
    s.line1.trim().length >= 1 &&
    s.line1.trim().length <= 120 &&
    s.city.trim().length >= 1 &&
    s.city.trim().length <= 80 &&
    s.postcode.trim().length >= 2 &&
    s.postcode.trim().length <= 16 &&
    /^[A-Za-z]{2}$/.test(s.country.trim())
  );
}

/** The first thing that is wrong, in the user's words, or null. Used for the
 *  blocked-reason line rather than reddening every empty field at once. */
export function shippingError(s: ShippingDraft): string | null {
  if (!s.name.trim()) return "Add the name the card should be addressed to.";
  if (!s.line1.trim()) return "Add a street address.";
  if (!s.city.trim()) return "Add a city or town.";
  if (s.postcode.trim().length < 2) return "Add a postcode.";
  if (!/^[A-Za-z]{2}$/.test(s.country.trim())) {
    return "Country must be a two-letter code, like GB, IN or US.";
  }
  return null;
}

export function ShippingForm({
  value,
  onChange,
  disabled = false,
}: {
  value: ShippingDraft;
  onChange: (next: ShippingDraft) => void;
  disabled?: boolean;
}) {
  const set = (key: keyof ShippingDraft) => (text: string) =>
    onChange({ ...value, [key]: key === "country" ? text.toUpperCase() : text });

  return (
    <View style={{ gap: spacing.sm }}>
      <Field
        label="Full name"
        value={value.name}
        onChangeText={set("name")}
        placeholder="As it should appear on the parcel"
        maxLength={80}
        editable={!disabled}
        autoComplete="name"
        accessibilityLabel="Recipient name"
      />
      <Field
        label="Address"
        value={value.line1}
        onChangeText={set("line1")}
        placeholder="Street and number"
        maxLength={120}
        editable={!disabled}
        autoComplete="street-address"
        accessibilityLabel="Address line one"
      />
      <Field
        value={value.line2}
        onChangeText={set("line2")}
        placeholder="Flat, floor, landmark (optional)"
        maxLength={120}
        editable={!disabled}
        accessibilityLabel="Address line two, optional"
      />
      <View style={styles.row}>
        <View style={{ flex: 2 }}>
          <Field
            label="City"
            value={value.city}
            onChangeText={set("city")}
            placeholder="City or town"
            maxLength={80}
            editable={!disabled}
            accessibilityLabel="City"
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="Postcode"
            value={value.postcode}
            onChangeText={set("postcode")}
            placeholder="000000"
            maxLength={16}
            editable={!disabled}
            autoCapitalize="characters"
            accessibilityLabel="Postcode"
          />
        </View>
      </View>
      <Field
        label="Country"
        value={value.country}
        onChangeText={set("country")}
        placeholder="GB"
        maxLength={2}
        editable={!disabled}
        autoCapitalize="characters"
        autoCorrect={false}
        accessibilityLabel="Country, two-letter code"
        accessibilityHint="Two-letter country code, for example GB, IN or US"
      />
      <Text style={styles.hint}>
        Two-letter country code — GB, IN, US, AE.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", gap: spacing.sm, alignItems: "flex-end" },
  hint: { color: colors.textFaint, fontSize: 12 },
});
