import React, { useEffect, useState } from "react";
import { AppState, StyleSheet, Text, View } from "react-native";
import { Stack, type ErrorBoundaryProps } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useAuth } from "@/lib/auth";
import {
  installNotificationRouting,
  installTokenRotation,
  reconcileInbox,
  registerForPush,
} from "@/lib/push";
import { queryClient } from "@/lib/queries";
import { resumeOpenSwaps } from "@/lib/swap/resumeBridges";
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

/** How long the app may sit in the background before the lock screen returns.
 *  Long enough to survive a Face ID prompt, a share sheet or a hand-off to a
 *  wallet app; short enough that a pocketed phone is locked. */
const LOCK_AFTER_BACKGROUND_MS = 30_000;

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
        {failed
          ? "Authentication failed — try again."
          : "Unlock with your fingerprint, face, or device PIN."}
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

  // Push: register the device once signed in (idempotent), keep the
  // registration current as FCM rotates the token, and route notification taps
  // — a 3DS2 approval push must land on /approvals.
  //
  // Both listeners are scoped to the signed-in session: torn down on sign-out,
  // reinstalled on the next sign-in, so a rotation is never registered against
  // the wrong account.
  useEffect(() => {
    if (status !== "signedIn") return;
    void registerForPush();
    const stopRouting = installNotificationRouting();
    const stopRotation = installTokenRotation();

    // Pull anything that landed in the system tray while we were backgrounded
    // into the local inbox — the foreground listener above cannot see those.
    // Re-run on every resume, and once now for the cold-start case.
    void reconcileInbox();

    // Same idea for money. A cross-chain swap's destination transfer lands
    // minutes after the source receipt, and the poller watching it dies with
    // the screen — so on launch and on every resume we re-read the real state
    // of anything still open. Fire-and-forget: it never throws, and app start
    // must not wait on the network.
    void resumeOpenSwaps();

    const appState = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        void reconcileInbox();
        void resumeOpenSwaps();
      }
    });

    return () => {
      stopRouting();
      stopRotation();
      appState.remove();
    };
  }, [status]);

  // Re-lock a backgrounded session.
  //
  // The app has an app-lock gate and a LockScreen, but nothing ever re-armed
  // it after hydrate(): once unlocked, the session stayed unlocked for as long
  // as the process lived. Handing someone an unlocked phone with FurlPay in
  // the recents therefore handed them the balances, transactions and card
  // list too.
  //
  // Grace period rather than an instant lock: the OS backgrounds the app for
  // the biometric prompt itself, for the share sheet, for the camera picker
  // and for the UPI/wallet app hand-off, and re-prompting on the way back from
  // those trains users to swat the prompt away. The clock starts when the app
  // leaves the foreground and is read when it returns, so a device that never
  // wakes the JS thread while backgrounded still locks.
  useEffect(() => {
    let leftForegroundAt: number | null = null;
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "background" || next === "inactive") {
        leftForegroundAt ??= Date.now();
        return;
      }
      if (next !== "active") return;
      const away = leftForegroundAt === null ? 0 : Date.now() - leftForegroundAt;
      leftForegroundAt = null;
      if (away >= LOCK_AFTER_BACKGROUND_MS) useAuth.getState().lock();
    });
    return () => sub.remove();
  }, []);

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
              {/* The address book. /contacts is the list; /contacts/new is a
                  modal because it is a task the user starts on top of whatever
                  they were doing (usually mid-send) and returns from. */}
              <Stack.Screen name="contacts/index" options={{ title: "Address book" }} />
              <Stack.Screen name="contacts/[id]" options={{ title: "Contact" }} />
              <Stack.Screen
                name="contacts/new"
                options={{ title: "New contact", presentation: "modal" }}
              />
              {/* Card lifecycle. The tab keeps the carousel and the everyday
                  controls; ordering and per-card management are their own
                  screens because both are tasks with a beginning and an end. */}
              <Stack.Screen name="cards/order" options={{ title: "Order a card" }} />
              <Stack.Screen name="cards/[id]" options={{ title: "Manage card" }} />
              <Stack.Screen name="swap" options={{ title: "Swap" }} />
              {/* /swap is the execution flow; /swaps is its history. Kept in
                  separate namespaces so a detail route can never shadow the
                  screen that starts a swap. */}
              <Stack.Screen name="swaps" options={{ title: "Swap history" }} />
              <Stack.Screen name="swaps/[id]" options={{ title: "Swap" }} />
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
              <Stack.Screen name="security" options={{ title: "Security" }} />
              <Stack.Screen name="passport" options={{ title: "Travel documents", headerShown: false }} />
              <Stack.Screen name="passport-scan" options={{ title: "Add document", presentation: "modal" }} />
              <Stack.Screen name="wallet" options={{ title: "Self-custodial wallet" }} />
              <Stack.Screen name="watch" options={{ headerShown: false }} />
              <Stack.Screen name="notifications" options={{ title: "Notifications" }} />
              <Stack.Screen name="delete-account" options={{ title: "Delete account" }} />
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
