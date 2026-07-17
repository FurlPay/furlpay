import React, { useRef, useState } from "react";
import { Linking, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { parseScannedAddress } from "@/lib/qr";
import { colors, spacing, type } from "@/lib/theme";
import { Button, Screen } from "@/components/ui";

export default function Scan() {
  const router = useRouter();
  const [permission, requestPermission] = useCameraPermissions();
  const [invalid, setInvalid] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const handled = useRef(false);

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
      <View style={styles.overlay}>
        <Text style={[type.dim, { textAlign: "center" }]}>
          {invalid
            ? "That QR doesn't contain a payable address — try another."
            : "Point at a wallet address or FurlPay payment QR."}
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: "center", justifyContent: "center", gap: spacing.lg, padding: spacing.xl },
  overlay: { padding: spacing.md, backgroundColor: colors.bg },
});
