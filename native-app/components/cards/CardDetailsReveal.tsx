import React, { useCallback, useEffect, useRef, useState } from "react";
import { Animated, AppState, Easing, StyleSheet, Text, View } from "react-native";
import * as Haptics from "expo-haptics";
import { CardBack } from "@/components/cards/CardArt";
import { CardFace } from "@/components/cards/CardFace";
import { Button, PreviewBanner } from "@/components/ui";
import { authenticateDeviceOwner } from "@/lib/biometrics";
import { REVEAL_VISIBLE_MS, designFor, type CardSecrets } from "@/lib/cards/designs";
import type { CardStatus } from "@/lib/cards/lifecycle";
import { useTheme } from "@/lib/design/theme";
import { useSecureScreen } from "@/lib/secureScreen";
import { spacing, type } from "@/lib/theme";

// ---------------------------------------------------------------------------
// Turn the card over to see its back: number, expiry, CVV.
//
// THE GATE IS DEVICE-OWNER PROOF, every time. Fingerprint, face, or the device
// PIN — and on a phone with no screen lock at all, nothing: there is no honest
// way to show card credentials to whoever happens to be holding it.
//
// THE BACK TURNS ITSELF AWAY. After REVEAL_VISIBLE_MS, and the moment the app
// leaves the foreground, the card flips to its front again. A card number left
// on a screen on a desk is the failure this exists to prevent.
//
// WHAT IS ON THE BACK TODAY: masks. Full details come only from the card
// issuer's PCI vault, and no issuer is connected (the server answers 503 for
// every reveal — apps/web lib/cardIssuer.ts). `secrets` is therefore always
// null here and CardBack prints dots. The day a vault exchange exists, this is
// the one place that passes its parsed response (`parseCardSecrets`) down.
// ---------------------------------------------------------------------------

export interface RevealableCard {
  label: string;
  last4: string;
  network: string;
  kind: "virtual" | "physical";
  gradient: readonly [string, string];
  themeId?: string;
  settlementCurrency?: string;
  frozen?: boolean;
  status?: CardStatus;
}

export function CardDetailsReveal({ card }: { card: RevealableCard }) {
  const { reduceMotion } = useTheme();
  const [flipped, setFlipped] = useState(false);
  const [denial, setDenial] = useState<"rejected" | "no_device_lock" | null>(null);
  const turn = useRef(new Animated.Value(0)).current;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Card details must not land in a screenshot or the recents thumbnail.
  useSecureScreen("card-details");

  // No vault exchange exists; see the header. Never a constructed value.
  const secrets: CardSecrets | null = null;

  const design = designFor({ themeId: card.themeId, gradient: card.gradient });

  const show = useCallback(
    (back: boolean) => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = back ? setTimeout(() => show(false), REVEAL_VISIBLE_MS) : null;
      setFlipped(back);
      if (reduceMotion) {
        turn.setValue(back ? 1 : 0);
        return;
      }
      Animated.timing(turn, {
        toValue: back ? 1 : 0,
        duration: 420,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }).start();
    },
    [reduceMotion, turn]
  );

  useEffect(() => {
    const sub = AppState.addEventListener("change", (s) => {
      if (s !== "active") show(false);
    });
    return () => {
      sub.remove();
      if (timer.current) clearTimeout(timer.current);
    };
  }, [show]);

  const reveal = async () => {
    const res = await authenticateDeviceOwner("Show the back of your card");
    if (!res.ok) {
      setDenial(res.reason);
      return;
    }
    setDenial(null);
    void Haptics.selectionAsync().catch(() => {});
    show(true);
  };

  const lockless = denial === "no_device_lock";

  const frontStyle = {
    opacity: turn.interpolate({ inputRange: [0, 0.5, 0.5, 1], outputRange: [1, 1, 0, 0] }),
    transform: [
      { perspective: 1200 },
      { rotateY: turn.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "180deg"] }) },
    ],
  };
  const backStyle = {
    opacity: turn.interpolate({ inputRange: [0, 0.5, 0.5, 1], outputRange: [0, 0, 1, 1] }),
    transform: [
      { perspective: 1200 },
      { rotateY: turn.interpolate({ inputRange: [0, 1], outputRange: ["180deg", "360deg"] }) },
    ],
  };

  return (
    <View style={{ gap: spacing.md }}>
      <View>
        <Animated.View style={frontStyle} pointerEvents={flipped ? "none" : "auto"}>
          <CardFace {...card} />
        </Animated.View>
        <Animated.View
          style={[StyleSheet.absoluteFill, backStyle]}
          pointerEvents={flipped ? "auto" : "none"}
          accessibilityElementsHidden={!flipped}
          importantForAccessibility={flipped ? "auto" : "no-hide-descendants"}
        >
          <CardBack
            design={design}
            gradient={card.gradient}
            last4={card.last4}
            network={card.network}
            secrets={secrets}
            style={{ flex: 1 }}
          />
        </Animated.View>
      </View>

      {flipped ? (
        <>
          <PreviewBanner text="Your full card number, expiry and CVV are held by the card issuer's secure vault, which isn't connected yet. The dots are not hiding anything: this app does not have those details." />
          <Button title="Turn card over" variant="secondary" onPress={() => show(false)} />
        </>
      ) : (
        <>
          <Text style={[type.dim, { textAlign: "center" }]}>
            {lockless
              ? "Set a screen lock (PIN, pattern, or biometrics) on this device to see the back of your card."
              : denial === "rejected"
                ? "Authentication failed. Try again."
                : "Seeing the back of your card needs your fingerprint, face, or device PIN."}
          </Text>
          {!lockless ? <Button title="Show card back" onPress={() => void reveal()} /> : null}
        </>
      )}
    </View>
  );
}
