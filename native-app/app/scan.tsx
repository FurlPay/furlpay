import React, { useRef, useState } from "react";
import { Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { parseScannedAddress } from "@/lib/qr";
import { looksLikeUpiUri, parseUpiUri } from "@/lib/upi";
import { looksLikePairingUri, parsePairingUri } from "@/lib/walletconnect/uri";
import { pairWithUri } from "@/lib/walletconnect/useWalletConnect";
import { ScannerFrame } from "@/components/ScannerFrame";
import { colors, radius, spacing, type } from "@/lib/theme";
import { Button, Field, Screen, Sheet } from "@/components/ui";

export default function Scan() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [invalid, setInvalid] = useState<null | "not_payable" | "bad_upi">(null);
  // A WalletConnect pairing failure carries its OWN message (expired, v1,
  // malformed key), and each sends the user somewhere different — so it gets a
  // string rather than joining the two-value `invalid` enum above.
  const [wcError, setWcError] = useState<string | null>(null);
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
    const entry = manual.trim();

    // A pairing URI is regularly COPIED rather than scanned — desktop dApps
    // offer "copy link" beside the QR — so manual entry accepts it too.
    if (looksLikePairingUri(entry)) {
      const parsed = parsePairingUri(entry);
      if (!parsed.ok) {
        setManualError(parsed.error.message);
        return;
      }
      setManualOpen(false);
      setManual("");
      setManualError(null);
      void Haptics.selectionAsync();
      router.replace("/walletconnect");
      void pairWithUri(entry, "paste");
      return;
    }

    // A UPI URI can be pasted as text (shared over WhatsApp is common), so the
    // manual path accepts the same inputs the camera does.
    const upi = parseUpiUri(entry);
    if (upi) {
      setManualOpen(false);
      setManual("");
      setManualError(null);
      void Haptics.selectionAsync();
      router.replace({ pathname: "/upi/confirm", params: { uri: entry } });
      return;
    }
    if (looksLikeUpiUri(entry)) {
      setManualError("That UPI link is damaged or incomplete.");
      return;
    }

    const address = parseScannedAddress(entry);
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

          // WalletConnect first. A `wc:` URI cannot be confused with a UPI URI
          // or an address, and putting it last would mean every dApp QR fell
          // through to parseScannedAddress and was reported as "not payable" —
          // which is true and useless.
          if (looksLikePairingUri(data)) {
            const parsed = parsePairingUri(data);
            if (!parsed.ok) {
              setWcError(parsed.error.message);
              return;
            }
            handled.current = true;
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            // Navigate FIRST, pair second. The proposal arrives asynchronously
            // and the approval sheet lives on /walletconnect; pairing from a
            // screen that is about to unmount would land the proposal with
            // nothing mounted to show it.
            router.replace("/walletconnect");
            void pairWithUri(data, "qr");
            return;
          }

          // UPI next: India's merchant QRs are upi:// URIs, and they can never
          // be mistaken for a crypto address, so the order costs nothing.
          const upi = parseUpiUri(data);
          if (upi) {
            handled.current = true;
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            router.replace({ pathname: "/upi/confirm", params: { uri: data } });
            return;
          }
          // A UPI QR we could not parse is a DIFFERENT failure from a QR that
          // holds no payment at all — say which, or the user just re-scans a QR
          // that will never work.
          if (looksLikeUpiUri(data)) {
            setInvalid("bad_upi");
            return;
          }

          const address = parseScannedAddress(data);
          if (address) {
            handled.current = true;
            void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            router.replace({ pathname: "/(tabs)/send", params: { to: address } });
          } else {
            setInvalid("not_payable");
          }
        }}
      />
      <ScannerFrame />

      <View style={styles.overlay}>
        <Text style={[type.dim, styles.hint]}>
          {/* The WalletConnect message wins when present: it is the specific
              one ("this link expired", "this site uses WalletConnect v1"), and
              the generic hints below cannot tell the user any of that. */}
          {wcError
            ? wcError
            : invalid === "bad_upi"
              ? "That UPI QR is damaged or incomplete — ask for a fresh one."
              : invalid === "not_payable"
                ? "That QR doesn't contain a payable address — try another."
                : "Point at a UPI QR, wallet address, dApp connection QR, or FurlPay payment QR."}
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
