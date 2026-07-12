import React, { useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import { EVM_ADDRESS_RE } from "@/lib/format";
import { colors, spacing, type } from "@/lib/theme";
import { Button, Screen } from "@/components/ui";

/** Pull a payable 0x address out of whatever the QR encodes: a bare address,
 *  an EIP-681 `ethereum:0x…` URI, or a furlpay.com payment link. */
function parseScannedAddress(data: string): string | null {
  const bare = data.trim();
  if (EVM_ADDRESS_RE.test(bare)) return bare;
  const eip681 = bare.match(/^ethereum:(0x[0-9a-fA-F]{40})/);
  if (eip681) return eip681[1];
  const inUrl = bare.match(/(0x[0-9a-fA-F]{40})/);
  if (inUrl && /^https?:\/\/(www\.)?furlpay\.com\//.test(bare)) return inUrl[1];
  return null;
}

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
