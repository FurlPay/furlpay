import React, { useEffect, useState } from "react";
import { AppState, Linking, StyleSheet, Text, View } from "react-native";
import { Stack, useRouter, type ErrorBoundaryProps } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { QueryClientProvider } from "@tanstack/react-query";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { type UnlockResult, useAuth } from "@/lib/auth";
import {
  installNotificationRouting,
  installTokenRotation,
  reconcileInbox,
  registerForPush,
} from "@/lib/push";
import { queryClient } from "@/lib/queries";
import { resumeOpenSwaps } from "@/lib/swap/resumeBridges";
import { recoverPendingTransactions } from "@/lib/money/reconcile";
import { spacing, ThemeProvider, useTheme } from "@/lib/design";
import { useI18n } from "@/lib/i18n";
import { clearStepUp } from "@/lib/security/riskPolicy";
import { loadFlags } from "@/lib/flags";
import { isPairingDeepLink } from "@/lib/deepLinks";
import { pairWithUri } from "@/lib/walletconnect/useWalletConnect";
import { track } from "@/lib/analytics";
import { Button, Screen } from "@/components/ui";
import { OfflineBanner } from "@/components/OfflineBanner";
import { startTamperDetection } from "@/lib/security/tamperDetection";

// Route-level crash screen (expo-router picks this export up for the whole
// tree since it's on the root layout). Keeps a render error from taking the
// app down to a red box — the user can retry in place.
export function ErrorBoundary({ error, retry }: ErrorBoundaryProps) {
  // NOT wrapped in ThemeProvider: this renders when the tree below has already
  // failed, so it must not depend on a provider that may be part of the
  // failure. useTheme() falls back to a resolved dark theme in that case.
  return (
    <ThemeProvider>
      <ErrorScreen message={error.message} onRetry={() => void retry()} />
    </ThemeProvider>
  );
}

function ErrorScreen({ message, onRetry }: { message: string; onRetry: () => void }) {
  const t = useTheme();
  const { t: tr } = useI18n();
  return (
    <Screen style={[styles.lock, { backgroundColor: t.colors.bg }]}>
      <Text style={t.type("title")} accessibilityRole="header">
        {tr("state.errorTitle")}
      </Text>
      <Text style={[t.type("dim"), { color: t.colors.textDim, textAlign: "center" }]}>{message}</Text>
      <Button title={tr("state.retry")} onPress={onRetry} style={{ alignSelf: "stretch" }} />
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
  const [result, setResult] = useState<UnlockResult | null>(null);
  const t = useTheme();
  const { t: tr } = useI18n();

  const attemptUnlock = () => {
    void unlock().then(setResult);
  };

  useEffect(() => {
    // Prompt immediately on mount; the button below covers retries.
    attemptUnlock();
  }, [unlock]);

  return (
    <Screen style={[styles.lock, { backgroundColor: t.colors.bg }]}>
      <Text style={t.type("title")} accessibilityRole="header">
        {tr("security.unlockTitle")}
      </Text>
      <Text style={[t.type("dim"), { color: t.colors.textDim, textAlign: "center" }]}>
        {result === "no_device_lock"
          ? tr("security.unlockNoDeviceLock")
          : result === "rejected"
            ? tr("security.unlockFailed")
            : tr("security.unlockPrompt")}
      </Text>
      <View style={{ gap: t.spacing.sm, alignSelf: "stretch" }}>
        <Button title={tr("security.unlock")} onPress={attemptUnlock} />
        <Button title={tr("security.signOut")} variant="secondary" onPress={() => void signOut()} />
      </View>
    </Screen>
  );
}

export default function RootLayout() {
  // ThemeProvider sits ABOVE everything that renders, and inside
  // SafeAreaProvider because it reads window dimensions for the size class.
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <QueryClientProvider client={queryClient}>
          <AppShell />
        </QueryClientProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

function AppShell() {
  const status = useAuth((s) => s.status);
  const hydrate = useAuth((s) => s.hydrate);
  const router = useRouter();
  const t = useTheme();
  const { t: tr } = useI18n();

  useEffect(() => {
    void hydrate();
  }, [hydrate]);

  // CLIENT FEATURE FLAGS, loaded once at launch and NOT gated on sign-in.
  //
  // The login screen is itself flag-sensitive, and a flag fetch that waited for
  // a session would leave the first screen a user ever sees rendering compiled
  // defaults. The endpoint accepts anonymous callers for exactly this reason
  // (apps/web/src/app/api/flags/client/route.ts).
  //
  // Never awaited and never fatal: loadFlags applies the cached layer
  // synchronously and swallows its own network failure, so app start does not
  // depend on the payload arriving.
  useEffect(() => {
    void loadFlags();
    void startTamperDetection();
    track("app_opened", { source: "cold" });
  }, []);

  // WALLETCONNECT PAIRING LINKS.
  //
  // A dApp on the same device hands the wallet a `wc:` URI through the OS
  // rather than a QR code — the mobile-browser flow, and the majority of
  // pairings on a phone. It arrives two ways and BOTH are needed: getInitialURL
  // for a cold start (FurlPay was not running when the user tapped "connect"),
  // and the `url` event for a warm one.
  //
  // Scoped to signedIn: pairing grants a dApp access to an ADDRESS, and there
  // is no address to grant before sign-in. A link that arrives on the login
  // screen is dropped rather than queued — the dApp's pairing has its own
  // expiry, and silently pairing later against whichever account signs in next
  // would grant a session the user never connected.
  useEffect(() => {
    if (status !== "signedIn") return;

    const handle = (url: string | null) => {
      if (!isPairingDeepLink(url)) return;
      // Navigate first so the approval sheet is mounted when the proposal
      // lands — same ordering as the scanner.
      router.push("/walletconnect");
      void pairWithUri(url!, "deeplink");
    };

    void Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener("url", ({ url }) => handle(url));
    return () => sub.remove();
  }, [status, router]);

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

    // RECONCILE MONEY LEFT IN DOUBT.
    //
    // Any transaction persisted as SUBMITTED or PROCESSING is one whose reply
    // we never saw — the app was killed mid-flight, the network dropped, the
    // request timed out. Recovery asks the server what happened; it NEVER
    // re-submits. Running it on cold start and on every resume is what turns
    // "did my money move?" from an unanswerable question into a GET.
    void recoverPendingTransactions();

    const appState = AppState.addEventListener("change", (next) => {
      if (next === "active") {
        void reconcileInbox();
        void resumeOpenSwaps();
        void recoverPendingTransactions();
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
      if (away >= LOCK_AFTER_BACKGROUND_MS) {
        // The step-up grace window must not survive a lock: otherwise whoever
        // unlocks the phone next inherits an authorization the previous holder
        // earned.
        clearStepUp();
        useAuth.getState().lock();
      }
    });
    return () => sub.remove();
  }, []);

  return (
    <>
      {/* The status bar icons must contrast with the app's ground, so the
          style is derived from the RESOLVED scheme rather than pinned to
          "light" — pinned light icons are invisible on a light background. */}
      <StatusBar style={t.scheme === "dark" ? "light" : "dark"} backgroundColor={t.colors.bg} />
      {status === "loading" ? (
        <Screen style={[styles.lock, { backgroundColor: t.colors.bg }]}>
          <Text style={t.type("title")}>FurlPay</Text>
        </Screen>
      ) : status === "locked" ? (
        <LockScreen />
      ) : (
          <View style={{ flex: 1, backgroundColor: t.colors.bg }}>
            <OfflineBanner />
            <Stack
              screenOptions={{
                headerStyle: { backgroundColor: t.colors.bg },
                headerTintColor: t.colors.text,
                headerTitleStyle: { fontWeight: "700", color: t.colors.text },
                contentStyle: { backgroundColor: t.colors.bg },
              }}
            >
              <Stack.Screen name="(auth)" options={{ headerShown: false }} />
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="transaction/[id]" options={{ title: tr("nav.transaction") }} />
              <Stack.Screen name="receive" options={{ title: tr("nav.receive") }} />
              <Stack.Screen name="scan" options={{ title: tr("nav.scan") }} />
              <Stack.Screen name="transactions" options={{ title: tr("nav.transactions") }} />
              {/* The address book. /contacts is the list; /contacts/new is a
                  modal because it is a task the user starts on top of whatever
                  they were doing (usually mid-send) and returns from. */}
              <Stack.Screen name="contacts/index" options={{ title: tr("nav.addressBook") }} />
              <Stack.Screen name="contacts/[id]" options={{ title: tr("nav.contact") }} />
              <Stack.Screen
                name="contacts/new"
                options={{ title: tr("nav.contactNew"), presentation: "modal" }}
              />
              {/* Card lifecycle. The tab keeps the carousel and the everyday
                  controls; ordering and per-card management are their own
                  screens because both are tasks with a beginning and an end. */}
              <Stack.Screen name="cards/order" options={{ title: tr("nav.cardOrder") }} />
              <Stack.Screen name="cards/[id]" options={{ title: tr("nav.cardManage") }} />
              <Stack.Screen name="swap" options={{ title: tr("nav.swap") }} />
              {/* /swap is the execution flow; /swaps is its history. Kept in
                  separate namespaces so a detail route can never shadow the
                  screen that starts a swap. */}
              <Stack.Screen name="swaps" options={{ title: tr("nav.swapHistory") }} />
              <Stack.Screen name="swaps/[id]" options={{ title: tr("nav.swapDetail") }} />
              <Stack.Screen name="earn" options={{ title: tr("nav.earn") }} />
              <Stack.Screen name="bills" options={{ title: tr("nav.bills") }} />
              <Stack.Screen name="banking" options={{ title: tr("nav.banking") }} />
              <Stack.Screen name="credit" options={{ title: tr("nav.credit") }} />
              <Stack.Screen name="rewards" options={{ title: tr("nav.rewards") }} />
              <Stack.Screen name="travel/index" options={{ title: tr("nav.travel") }} />
              <Stack.Screen name="travel/hotels" options={{ title: tr("nav.hotels") }} />
              <Stack.Screen name="travel/property/[id]" options={{ title: tr("nav.hotel") }} />
              <Stack.Screen name="travel/checkout" options={{ title: tr("nav.checkout") }} />
              <Stack.Screen name="travel/trip/[id]" options={{ title: tr("nav.trip") }} />
              <Stack.Screen name="analytics" options={{ title: tr("nav.spending") }} />
              <Stack.Screen name="markets" options={{ title: tr("nav.markets") }} />
              <Stack.Screen name="market/[symbol]" options={{ title: tr("nav.asset") }} />
              <Stack.Screen name="chains" options={{ title: tr("nav.chains") }} />
              <Stack.Screen name="collection/[slug]" options={{ title: tr("nav.collection") }} />
              <Stack.Screen name="insights" options={{ title: tr("nav.research") }} />
              <Stack.Screen name="chat" options={{ title: tr("nav.copilot") }} />
              <Stack.Screen name="approvals" options={{ title: tr("nav.approvals") }} />
              <Stack.Screen name="support/index" options={{ title: tr("nav.support") }} />
              <Stack.Screen name="support/[id]" options={{ title: tr("nav.supportConversation") }} />
              <Stack.Screen name="passkeys" options={{ title: tr("nav.passkeys") }} />
              <Stack.Screen name="security" options={{ title: tr("nav.security") }} />
              <Stack.Screen name="appearance" options={{ title: tr("nav.appearance") }} />
              {/* Not linked from the product UI; reached from Appearance or by
                  deep link. Shipped in release so theming and font-scale bugs
                  can be checked on a real device. */}
              <Stack.Screen name="design-system" options={{ title: tr("nav.designSystem") }} />
              <Stack.Screen name="passport" options={{ title: tr("nav.travelDocs"), headerShown: false }} />
              <Stack.Screen name="passport-scan" options={{ title: tr("nav.addDocument"), presentation: "modal" }} />
              <Stack.Screen name="wallet" options={{ title: tr("nav.wallet") }} />
              {/* Connected sites. /walletconnect lists the standing grants;
                  /walletconnect/[topic] is one grant, and the place it is
                  revoked. Both are ordinary pushed screens rather than
                  modals — a permission list is somewhere users navigate back
                  to, not a task with an end. */}
              <Stack.Screen name="walletconnect/index" options={{ title: tr("nav.connectedSites") }} />
              <Stack.Screen name="walletconnect/[topic]" options={{ title: tr("nav.connectedSite") }} />
              <Stack.Screen name="tokens" options={{ title: tr("nav.tokens") }} />
              <Stack.Screen name="nft/index" options={{ title: tr("nav.nft") }} />
              <Stack.Screen name="nft/[id]" options={{ title: tr("nav.nftDetail") }} />
              {/* Liquid staking. Deliberately a separate screen from /earn:
                  different yield source, different risk, different exit. */}
              <Stack.Screen name="staking" options={{ title: tr("nav.staking") }} />
              {/* P2P. The book, one offer, the user's orders, and one live
                  trade. /p2p/order/[id] is the screen a user returns to
                  repeatedly during a trade, so it is a pushed screen with a
                  stable URL rather than a modal. */}
              <Stack.Screen name="p2p/index" options={{ title: tr("nav.p2p") }} />
              <Stack.Screen name="p2p/orders" options={{ title: tr("p2p.myOrders") }} />
              <Stack.Screen name="p2p/ad/[id]" options={{ title: tr("nav.p2p") }} />
              <Stack.Screen name="p2p/order/[id]" options={{ title: tr("nav.p2pOrder") }} />
              <Stack.Screen name="watch" options={{ headerShown: false }} />
              <Stack.Screen name="notifications" options={{ title: tr("nav.notifications") }} />
              <Stack.Screen name="delete-account" options={{ title: tr("nav.deleteAccount") }} />
            </Stack>
          </View>
        )}
    </>
  );
}

// Layout only — no colours. Every colour on these screens comes from the theme
// at render time, so this sheet can stay static without pinning a scheme.
const styles = StyleSheet.create({
  lock: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
    padding: spacing.xl,
  },
});
