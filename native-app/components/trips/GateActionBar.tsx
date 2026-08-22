import React from "react";
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { trips, tripsRadius } from "./tripsTheme";
import { Barcode } from "./BoardingPassCard";
import type { BoardingPass } from "@/lib/boardingPass";

/**
 * The action bar under the pass: one wide dark pill and a round overflow button.
 *
 * The reference design labels the pill "Add to Apple Wallet". That is NOT what
 * it does here, and pretending otherwise would be the exact failure mode this
 * codebase refuses elsewhere — a control that looks like it worked and did
 * nothing. Nothing in FurlPay issues a .pkpass or a Google Wallet object yet
 * (there is no pass-signing endpoint, no issuer id, no certificate), so the
 * button does the thing a passenger at a gate actually needs and that we can
 * genuinely deliver today: put the barcode full-screen.
 *
 * The slot, its geometry and its weight in the layout are the design's. When a
 * pass-issuing endpoint lands, this is the button that changes.
 */
export function GateActionBar({
  pass,
  onShowDetails,
  onShare,
}: {
  pass: BoardingPass;
  onShowDetails: () => void;
  onShare: () => void;
}) {
  const [gateOpen, setGateOpen] = React.useState(false);
  const [menuOpen, setMenuOpen] = React.useState(false);

  return (
    <View style={styles.row}>
      <Pressable
        style={({ pressed }) => [styles.primary, pressed && styles.pressed]}
        onPress={() => setGateOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Show the boarding pass for ${pass.flight.number} full screen for scanning`}
      >
        <View style={styles.primaryIcon}>
          <Ionicons name="scan-outline" size={20} color="#FFFFFF" />
        </View>
        <View>
          <Text style={styles.primaryTop}>Show at</Text>
          <Text style={styles.primaryBottom}>gate</Text>
        </View>
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.more, pressed && styles.pressed]}
        onPress={() => setMenuOpen(true)}
        accessibilityRole="button"
        accessibilityLabel="More trip options"
      >
        <Ionicons name="ellipsis-horizontal" size={22} color="#3C3C43" />
      </Pressable>

      <GateScreen pass={pass} visible={gateOpen} onClose={() => setGateOpen(false)} />

      <Modal visible={menuOpen} transparent animationType="fade" onRequestClose={() => setMenuOpen(false)}>
        <Pressable style={styles.scrim} onPress={() => setMenuOpen(false)}>
          <View style={styles.menu}>
            <MenuItem
              icon="information-circle-outline"
              label="Flight details"
              onPress={() => {
                setMenuOpen(false);
                onShowDetails();
              }}
            />
            <MenuItem
              icon="share-outline"
              label="Share pass"
              onPress={() => {
                setMenuOpen(false);
                onShare();
              }}
            />
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

function MenuItem({
  icon,
  label,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>["name"];
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={({ pressed }) => [styles.menuItem, pressed && styles.menuItemPressed]} onPress={onPress}>
      <Ionicons name={icon} size={18} color={trips.passInkDim} />
      <Text style={styles.menuLabel}>{label}</Text>
    </Pressable>
  );
}

/**
 * Full-screen pass. White ground, barcode as wide as the display allows: gate
 * scanners want maximum contrast and quiet zones, and a phone held at an angle
 * under an airport skylight has neither to spare.
 */
function GateScreen({
  pass,
  visible,
  onClose,
}: {
  pass: BoardingPass;
  visible: boolean;
  onClose: () => void;
}) {
  const { width } = useWindowDimensions();
  const barWidth = Math.max(240, width - 48);

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose} statusBarTranslucent>
      <View style={styles.gate}>
        <Pressable
          style={styles.gateClose}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close boarding pass"
        >
          <Ionicons name="close" size={26} color={trips.passInk} />
        </Pressable>

        <Text style={styles.gateFlight}>{pass.flight.number}</Text>
        <Text style={styles.gateRoute}>
          {pass.flight.originCode} → {pass.flight.destinationCode}
        </Text>

        <Barcode value={pass.id} width={barWidth} height={140} />
        <Text style={styles.gateId}>{pass.id}</Text>

        <View style={styles.gateFacts}>
          <GateFact label="Gate" value={pass.flight.gate} />
          <GateFact label="Seat" value={pass.flight.seat} />
          <GateFact label="Boards" value={pass.flight.boardingTime} />
        </View>
        <Text style={styles.gatePassenger}>{pass.passenger.name}</Text>
      </View>
    </Modal>
  );
}

function GateFact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.gateFact}>
      <Text style={styles.gateFactLabel}>{label}</Text>
      <Text style={styles.gateFactValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 12, marginTop: 12 },
  primary: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    backgroundColor: trips.walletBg,
    borderRadius: tripsRadius.pill,
    paddingHorizontal: 16,
    paddingVertical: 11,
  },
  primaryIcon: {
    width: 38,
    height: 30,
    borderRadius: 7,
    backgroundColor: "rgba(255,255,255,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  primaryTop: { fontSize: 17, fontWeight: "500", color: "#FFFFFF", lineHeight: 20 },
  primaryBottom: { fontSize: 17, fontWeight: "500", color: "#FFFFFF", lineHeight: 20 },
  more: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#EBEBED",
    alignItems: "center",
    justifyContent: "center",
  },
  pressed: { opacity: 0.85, transform: [{ scale: 0.985 }] },

  scrim: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end", padding: 16 },
  menu: { backgroundColor: "#FFFFFF", borderRadius: tripsRadius.tile, overflow: "hidden" },
  menuItem: { flexDirection: "row", alignItems: "center", gap: 11, paddingHorizontal: 16, paddingVertical: 14 },
  menuItemPressed: { backgroundColor: "rgba(0,0,0,0.05)" },
  menuLabel: { fontSize: 16, color: trips.passInk },

  gate: { flex: 1, backgroundColor: "#FFFFFF", alignItems: "center", paddingTop: 72, gap: 14 },
  gateClose: { position: "absolute", top: 24, right: 20, padding: 8 },
  gateFlight: { fontSize: 34, fontWeight: "700", color: trips.passInk, letterSpacing: -0.8 },
  gateRoute: { fontSize: 17, color: trips.passInkDim, marginBottom: 10 },
  gateId: { fontSize: 12, color: trips.passInkDim, letterSpacing: 1 },
  gateFacts: { flexDirection: "row", gap: 36, marginTop: 18 },
  gateFact: { alignItems: "center", gap: 4 },
  gateFactLabel: { fontSize: 13, color: trips.passInkDim },
  gateFactValue: { fontSize: 22, fontWeight: "600", color: trips.passInk },
  gatePassenger: { fontSize: 17, color: trips.passInk, marginTop: 6 },
});
