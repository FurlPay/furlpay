import React, { useEffect } from "react";
import { Text, View } from "react-native";
import { Stack, usePathname, useRouter } from "expo-router";
import { useAuth } from "@/lib/auth";
import { resolveDeepLink, HOME_ROUTE } from "@/lib/deepLinks";
import { colors, spacing, type } from "@/lib/theme";
import { Button, Screen } from "@/components/ui";

// Global catch-all for any deep link that reaches Expo Router without matching a
// native route — a web-only OAuth/handoff URL (furlpay.com/auth/handoff, which
// Android may re-open into the app via App Links), a stale FCM notification
// target, or a link to a resource that no longer exists. Instead of Expo
// Router's raw "Unmatched Route" developer screen, we resolve the attempted path
// to the nearest real route and send the user there.
//
// This is the last-resort net; lib/deepLinks.ts is the front-line resolver that
// FCM taps already go through. Between them, no FurlPay-generated URI can dead-
// end on the error screen.
export default function NotFound() {
  const router = useRouter();
  const pathname = usePathname();
  const status = useAuth((s) => s.status);

  useEffect(() => {
    // Signed out → the auth stack owns navigation; let the root redirect handle
    // it. Signed in → resolve the attempted path to a real screen.
    if (status !== "signedIn") {
      router.replace("/(auth)/login");
      return;
    }
    const target = resolveDeepLink(pathname) || HOME_ROUTE;
    router.replace(target as never);
  }, [status, pathname, router]);

  // Brief, branded holding state (usually invisible — the redirect fires on
  // mount) so the user never sees the raw dev error screen.
  return (
    <Screen>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, padding: spacing.xl }}>
        <Text style={type.title}>FurlPay</Text>
        <Text style={[type.dim, { textAlign: "center" }]}>Taking you back to the app…</Text>
        <Button title="Go home" onPress={() => router.replace(HOME_ROUTE as never)} />
      </View>
    </Screen>
  );
}
