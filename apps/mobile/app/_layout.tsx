import React, { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useAuth } from "@/lib/auth";
import { colors, spacing, type } from "@/lib/theme";
import { Button, Screen } from "@/components/ui";
import { OfflineBanner } from "@/components/OfflineBanner";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

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
