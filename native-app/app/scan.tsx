import React, { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
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
  const handled = useRef(false);

  if (!permission) return <Screen />;

  if (!permission.granted) {
    return (
      <Screen style={styles.center}>
        <Text style={[type.body, { textAlign: "center" }]}>
          FurlPay needs camera access to scan payment QR codes.
        </Text>
        <Button title="Allow camera" onPress={() => void requestPermission()} />
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
