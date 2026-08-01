import React, { useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { parseScannedAddress } from "@/lib/qr";
import { ScannerFrame } from "@/components/ScannerFrame";
import { colors, radius, spacing, type } from "@/lib/theme";
import { Button, Field, Screen, Sheet } from "@/components/ui";

export default function Scan() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [invalid, setInvalid] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [manualOpen, setManualOpen] = useState(false);
  const [manual, setManual] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const handled = useRef(false);

  // Manual entry — the web's "Enter address manually" escape hatch, for a
  // damaged QR or an address received as text. Validated through the SAME
  // parser the camera uses, so a bad paste is rejected here rather than
  // surfacing as a failed send later.
  const submitManual = () => {
    const address = parseScannedAddress(manual.trim());
    if (!address) {
      setManualError("That doesn't look like a payable address.");
      return;
    }
    setManualOpen(false);
    setManual("");
    setManualError(null);
    void Haptics.selectionAsync();
    router.replace({ pathname: "/(tabs)/send", params: { to: address } });
  };

  if (!permission) return <Screen />;

  if (!permission.granted) {
    // Once Android has recorded a denial, canAskAgain flips to false and
    // requestPermission() resolves WITHOUT showing a system dialog — so the
    // "Allow camera" button appears to do nothing. In that state the only way
    // to grant is the app's system settings page. Detect it and route there.
    const mustUseSettings = !permission.canAskAgain;

    const onPress = async () => {
      if (mustUseSettings) {
        await Linking.openSettings();
        return;
      }
      setRequesting(true);
      try {
        const res = await requestPermission();
        // If the OS silently refused to prompt (already permanently denied),
        // fall back to settings so the button is never a no-op.
        if (!res.granted && !res.canAskAgain) await Linking.openSettings();
      } finally {
        setRequesting(false);
      }
    };

    return (
      <Screen style={styles.center}>
        <Text style={[type.body, { textAlign: "center" }]}>
          FurlPay needs camera access to scan payment QR codes.
        </Text>
        {mustUseSettings ? (
          <Text style={[type.dim, { textAlign: "center" }]}>
            Camera access was turned off. Enable it in Settings to scan.
          </Text>
        ) : null}
        <Button
          title={mustUseSettings ? "Open settings" : "Allow camera"}
          loading={requesting}
          onPress={() => void onPress()}
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <CameraView
        style={{ flex: 1 }}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={({ data }) => {
          if (handled.current) return;
          const address = parseScannedAddress(data);
          if (address) {
            handled.current = true;
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            router.replace({ pathname: "/(tabs)/send", params: { to: address } });
          } else {
            setInvalid(true);
          }
        }}
      />
      <ScannerFrame />

      <View style={styles.overlay}>
        <Text style={[type.dim, styles.hint]}>
          {invalid
            ? "That QR doesn't contain a payable address — try another."
            : "Point at a wallet address or FurlPay payment QR."}
        </Text>
        <Pressable
          onPress={() => {
            setManualError(null);
            setManualOpen(true);
          }}
          style={styles.manualBtn}
          accessibilityRole="button"
          accessibilityLabel="Enter address manually"
        >
          <Ionicons name="create-outline" size={16} color={colors.text} />
          <Text style={styles.manualLabel}>Enter address manually</Text>
        </Pressable>
      </View>

      <Sheet open={manualOpen} onClose={() => setManualOpen(false)} title="Enter address">
        <Field
          label="Wallet address"
          value={manual}
          onChangeText={(t) => {
            setManual(t);
            setManualError(null);
          }}
          placeholder="0x… or a FurlPay payment link"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {manualError ? <Text style={styles.manualError}>{manualError}</Text> : null}
        <Button title="Continue" onPress={submitManual} disabled={!manual.trim()} style={{ alignSelf: "stretch" }} />
      </Sheet>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center", gap: spacing.lg, padding: spacing.xl },
  overlay: { padding: spacing.md, gap: spacing.md, backgroundColor: colors.bg, alignItems: "center" },
  hint: { textAlign: "center" },
  manualBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 1,
    borderColor: colors.border,
  },
  manualLabel: { color: colors.text, fontSize: 14, fontWeight: "600" },
  manualError: { color: colors.accent, fontSize: 12, alignSelf: "stretch" },
});
