import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Stack, type ErrorBoundaryProps } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useAuth } from "@/lib/auth";
import { installNotificationRouting, registerForPush } from "@/lib/push";
import { queryClient } from "@/lib/queries";
import { colors, spacing, type } from "@/lib/theme";
import { Button, Screen } from "@/components/ui";
import { OfflineBanner } from "@/components/OfflineBanner";

// Route-level crash screen (expo-router picks this export up for the whole
// tree since it's on the root layout). Keeps a render error from taking the
// app down to a red box — the user can retry in place.
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  return (
    <Screen style={styles.lock}>
      <Text style={type.title}>Something went wrong</Text>
      <Text style={[type.dim, { textAlign: "center" }]}>{error.message}</Text>
      <Button title="Try again" onPress={() => void retry()} style={{ alignSelf: "stretch" }} />
    </Screen>
  );
}

function LockScreen() {
  const unlock = useAuth((s) => s.unlock);
  const signOut = useAuth((s) => s.signOut);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    // Prompt immediately on mount; the button below covers retries.
    void unlock().then((ok) => setFailed(!ok));
  }, [unlock]);

  return (
    <Screen style={styles.lock}>
      <Text style={type.title}>FurlPay</Text>
      <Text style={[type.dim, { textAlign: "center" }]}>
        {failed ? "Authentication failed — try again." : "Unlock with your fingerprint or face."}
      </Text>
      <View style={{ gap: spacing.sm, alignSelf: "stretch" }}>
        <Button title="Unlock" onPress={() => void unlock().then((ok) => setFailed(!ok))} />
        <Button title="Sign out" variant="secondary" onPress={() => void signOut()} />
      </View>
    </Screen>
  );
}

export default function RootLayout() {
  const status = useAuth((s) => s.status);
  const hydrate = useAuth((s) => s.hydrate);

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // Push: register the device once signed in (idempotent), and route
  // notification taps — a 3DS2 approval push must land on /approvals.
  useEffect(() => {
    if (status !== "signedIn") return;
    void registerForPush();
    return installNotificationRouting();
  }, [status]);

  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <StatusBar style="light" backgroundColor={colors.bg} />
        {status === "loading" ? (
          <Screen style={styles.lock}>
            <Text style={type.title}>FurlPay</Text>
          </Screen>
        ) : status === "locked" ? (
          <LockScreen />
        ) : (
          <View style={{ flex: 1, backgroundColor: colors.bg }}>
            <OfflineBanner />
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: colors.bg },
                headerTintColor: colors.text,
                headerTitleStyle: { fontWeight: "700" },
                contentStyle: { backgroundColor: colors.bg },
              }}
            >
              <Stack.Screen name="(auth)" options={{ headerShown: false }} />
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="transaction/[id]" options={{ title: "Transaction" }} />
              <Stack.Screen name="receive" options={{ title: "Receive" }} />
              <Stack.Screen name="scan" options={{ title: "Scan to pay" }} />
              <Stack.Screen name="transactions" options={{ title: "All transactions" }} />
              <Stack.Screen name="swap" options={{ title: "Swap" }} />
              <Stack.Screen name="earn" options={{ title: "Earn" }} />
              <Stack.Screen name="bills" options={{ title: "Bills" }} />
              <Stack.Screen name="banking" options={{ title: "Banking" }} />
              <Stack.Screen name="credit" options={{ title: "Credit line" }} />
              <Stack.Screen name="rewards" options={{ title: "Rewards" }} />
              <Stack.Screen name="travel/index" options={{ title: "Travel" }} />
              <Stack.Screen name="travel/hotels" options={{ title: "Hotels" }} />
              <Stack.Screen name="travel/property/[id]" options={{ title: "Hotel" }} />
              <Stack.Screen name="travel/checkout" options={{ title: "Checkout" }} />
              <Stack.Screen name="travel/trip/[id]" options={{ title: "Trip" }} />
              <Stack.Screen name="analytics" options={{ title: "Spending" }} />
              <Stack.Screen name="markets" options={{ title: "Markets" }} />
              <Stack.Screen name="market/[symbol]" options={{ title: "Asset" }} />
              <Stack.Screen name="chains" options={{ title: "Blockchain networks" }} />
              <Stack.Screen name="collection/[slug]" options={{ title: "Collection" }} />
              <Stack.Screen name="insights" options={{ title: "Research" }} />
              <Stack.Screen name="chat" options={{ title: "Co-pilot" }} />
              <Stack.Screen name="approvals" options={{ title: "Approvals" }} />
              <Stack.Screen name="support/index" options={{ title: "Support" }} />
              <Stack.Screen name="support/[id]" options={{ title: "Support conversation" }} />
              <Stack.Screen name="passkeys" options={{ title: "Passkeys" }} />
              <Stack.Screen name="wallet" options={{ title: "Self-custodial wallet" }} />
              <Stack.Screen name="notifications" options={{ title: "Notifications" }} />
            </Stack>
          </View>
        )}
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  lock: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
    padding: spacing.xl,
  },
});
