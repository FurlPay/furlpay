"use client";

import { useEffect, useState } from "react";
import {
  DEFAULT_PREFERENCES,
  loadPreferences,
  patchProfile,
  savePreferences,
  type DevicePreferences,
  type Profile,
} from "@/lib/accountApi";
import { Feedback, NotWiredNote, Row, Section, SelectRow, StatusPill, Toggle } from "./primitives";

// ---------------------------------------------------------------------------
// Preferences.
//
// Split by where the setting actually lives, because the honesty of this
// section depends on that distinction:
//
//   notifications        REAL and per-account. PATCH /api/profile stores all
//                        four flags; they follow the user to every device.
//   language / currency  No column exists, so they persist to localStorage —
//                        genuinely saved, genuinely per-device, and labelled
//                        that way. Not a fabricated "Saved" against a server
//                        that was never told.
//   theme                Shown as a fixed value, not a select. FurlPay has one
//                        palette (OLED black); a theme picker whose Light
//                        option changed nothing would be the clearest possible
//                        example of a control that lies.
// ---------------------------------------------------------------------------

const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch" },
  { value: "es", label: "Español" },
  { value: "fr", label: "Français" },
  { value: "ja", label: "日本語" },
];

const CURRENCIES = [
  { value: "USD", label: "USD $" },
  { value: "EUR", label: "EUR €" },
  { value: "GBP", label: "GBP £" },
  { value: "INR", label: "INR ₹" },
  { value: "SGD", label: "SGD $" },
];

const NOTIFICATION_LABELS: Record<keyof Profile["notifications"], { label: string; hint: string }> = {
  transactions: { label: "Transaction alerts", hint: "Payments, transfers and card activity." },
  security: { label: "Security alerts", hint: "New sign-ins and changes to your credentials." },
  priceAlerts: { label: "Price alerts", hint: "Movements on symbols you watch." },
  product: { label: "Product updates", hint: "New features and occasional announcements." },
};

export default function PreferencesSection({
  profile,
  onChanged,
}: {
  profile: Profile;
  onChanged: () => void;
}) {
  const [prefs, setPrefs] = useState<DevicePreferences>(DEFAULT_PREFERENCES);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  // Read on mount rather than during render: localStorage is not available on
  // the server, and reading it in the initial state would break hydration.
  useEffect(() => setPrefs(loadPreferences()), []);

  function updatePref(patch: Partial<DevicePreferences>) {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    if (!savePreferences(next)) {
      // A private window or storage disabled entirely — the selection stands
      // for this visit but will not survive a reload, and saying so is better
      // than letting it silently reset.
      setFeedback({
        tone: "error",
        text: "This browser is blocking local storage, so the choice will not be remembered after you reload.",
      });
      return;
    }
    setFeedback({ tone: "success", text: "Saved on this device." });
  }

  async function toggleNotification(key: keyof Profile["notifications"], value: boolean) {
    setFeedback(null);
    try {
      await patchProfile({ notifications: { [key]: value } });
      onChanged();
    } catch {
      setFeedback({ tone: "error", text: "Could not save that preference. Please try again." });
    }
  }

  return (
    <Section title="Preferences" description="How FurlPay looks and what it tells you about." id="preferences">
      <Row label="Theme" hint="FurlPay uses a single OLED-black palette today.">
        <StatusPill tone="muted">Dark</StatusPill>
      </Row>

      <SelectRow
        label="Language"
        hint="Saved on this device."
        value={prefs.language}
        options={LANGUAGES}
        onChange={(v) => updatePref({ language: v })}
      />

      <SelectRow
        label="Display currency"
        hint="Saved on this device."
        value={prefs.currency}
        options={CURRENCIES}
        onChange={(v) => updatePref({ currency: v })}
      />

      {(Object.keys(NOTIFICATION_LABELS) as (keyof Profile["notifications"])[]).map((key) => (
        <Toggle
          key={key}
          label={NOTIFICATION_LABELS[key].label}
          hint={NOTIFICATION_LABELS[key].hint}
          checked={profile.notifications[key]}
          onChange={(v) => toggleNotification(key, v)}
        />
      ))}

      {feedback && <Feedback tone={feedback.tone}>{feedback.text}</Feedback>}

      <NotWiredNote>
        Notification choices are stored on your account. Language and display currency are kept in
        this browser until a preferences API exists to carry them between devices, and neither
        re-renders the app yet.
      </NotWiredNote>
    </Section>
  );
}
