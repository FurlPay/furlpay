import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import NetInfo from "@react-native-community/netinfo";
import { flushPendingActions } from "@/lib/sync";
import { colors } from "@/lib/theme";

/** Shows an "offline" strip; when connectivity returns, flushes the outbox. */
export function OfflineBanner() {
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    const unsub = NetInfo.addEventListener((state) => {
      const isOffline = state.isConnected === false;
      setOffline(isOffline);
      if (!isOffline) void flushPendingActions();
    });
    return unsub;
  }, []);

  if (!offline) return null;
  return (
    <View style={styles.banner}>
      <Text style={styles.text}>Offline — showing cached data. Sends will queue.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    backgroundColor: "#2A230A",
    paddingVertical: 6,
    paddingHorizontal: 16,
    alignItems: "center",
  },
  text: { color: colors.warning, fontSize: 12, fontWeight: "600" },
});
