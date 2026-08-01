import React, { useCallback, useMemo, useRef, useState } from "react";
import { Animated, PanResponder, StyleSheet, View } from "react-native";
import * as Haptics from "expo-haptics";
import PassportCard, { type TravelDocumentView } from "@/components/PassportCard";
import { spacing } from "@/lib/theme";

// ---------------------------------------------------------------------------
// Apple Wallet-style document stack.
//
// WHY NOT REANIMATED + GESTURE HANDLER. Neither is installed, and android/ is
// prebuilt — adding a native module forces a rebuild that invalidates the
// signed AAB waiting on Play review. Everything below runs on RN's built-in
// Animated with useNativeDriver, so the drag stays on the UI thread and holds
// 60fps without a new dependency. This is the same decision SwipeToConfirm
// made on the swap screen.
//
// THE MODEL. One Animated.Value, `pos`, holds the FRACTIONAL active index.
// Each card derives its transform from (index - pos), so a drag moves every
// card in the stack coherently instead of animating one card against a static
// backdrop. Releasing springs `pos` to a whole number.
//
// Deriving from a single value also means there is no per-card state to fall
// out of sync — the stack cannot end up with two cards believing they are on
// top.
// ---------------------------------------------------------------------------

const CARD_HEIGHT = 190;
/** Vertical peek of each card behind the active one. */
const PEEK = 26;
/** Drag distance that equals one card of travel. */
const STEP = CARD_HEIGHT * 0.45;
/** Past this velocity a flick advances even from a short drag. */
const FLICK_VELOCITY = 0.55;
/** Cards rendered behind the active one before they stop being drawn. */
const VISIBLE_BEHIND = 3;

interface Props {
  documents: TravelDocumentView[];
  onPressDocument?: (doc: TravelDocumentView) => void;
}

export function PassportCardStack({ documents, onPressDocument }: Props) {
  const [active, setActive] = useState(0);
  const pos = useRef(new Animated.Value(0)).current;

  // Mirrors `pos` on the JS side: Animated.Value cannot be read synchronously
  // inside the responder, and the release decision needs the live position.
  const posRef = useRef(0);
  const activeRef = useRef(0);
  activeRef.current = active;

  const settle = useCallback(
    (next: number) => {
      const clamped = Math.max(0, Math.min(documents.length - 1, next));
      if (clamped !== activeRef.current) {
        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
        setActive(clamped);
      }
      posRef.current = clamped;
      Animated.spring(pos, {
        toValue: clamped,
        useNativeDriver: true,
        // Over-damped: the stack settles decisively. A bouncy stack of
        // identity documents reads as a toy.
        damping: 20,
        stiffness: 190,
        mass: 0.85,
      }).start();
    },
    [documents.length, pos]
  );

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Claim only clearly-vertical drags, so a horizontal swipe or a tap
        // on the card still reaches the card itself.
        onMoveShouldSetPanResponder: (_e, g) =>
          documents.length > 1 && Math.abs(g.dy) > 6 && Math.abs(g.dy) > Math.abs(g.dx),

        onPanResponderGrant: () => {
          pos.stopAnimation((v) => {
            posRef.current = v;
          });
        },

        onPanResponderMove: (_e, g) => {
          // Dragging DOWN reveals earlier cards, so it decreases the index.
          let next = activeRef.current - g.dy / STEP;
          // Rubber-band past both ends rather than clamping dead, so the edge
          // of the stack feels like a boundary instead of a broken gesture.
          const max = documents.length - 1;
          if (next < 0) next = next / 3;
          else if (next > max) next = max + (next - max) / 3;
          posRef.current = next;
          pos.setValue(next);
        },

        onPanResponderRelease: (_e, g) => {
          // A flick advances exactly one card from wherever the drag reached,
          // so a fast gesture never skips past a document the user wanted to
          // see. Otherwise snap to whichever card the stack is nearest.
          if (Math.abs(g.vy) >= FLICK_VELOCITY) {
            settle(activeRef.current + (g.vy < 0 ? 1 : -1));
          } else {
            settle(Math.round(posRef.current));
          }
        },

        // A system interruption must leave the stack on a whole card, never
        // parked between two.
        onPanResponderTerminate: () => settle(Math.round(posRef.current)),
        onPanResponderTerminationRequest: () => true,
      }),
    [documents.length, pos, settle]
  );

  if (documents.length === 0) return null;

  return (
    <View
      style={[styles.stack, { height: CARD_HEIGHT + PEEK * Math.min(documents.length - 1, VISIBLE_BEHIND) }]}
      {...(documents.length > 1 ? responder.panHandlers : {})}
      accessibilityRole="list"
      accessibilityLabel={`${documents.length} travel ${documents.length === 1 ? "document" : "documents"}`}
    >
      {documents.map((doc, i) => {
        // Distance from the active card as an Animated expression.
        const distance = Animated.subtract(i, pos);

        const translateY = distance.interpolate({
          inputRange: [-1, 0, 1, 2, 3],
          outputRange: [-CARD_HEIGHT * 0.6, 0, PEEK, PEEK * 1.85, PEEK * 2.55],
          extrapolate: "clamp",
        });
        const scale = distance.interpolate({
          inputRange: [-1, 0, 1, 2, 3],
          outputRange: [0.92, 1, 0.965, 0.93, 0.9],
          extrapolate: "clamp",
        });
        const opacity = distance.interpolate({
          inputRange: [-1, -0.4, 0, 1, 2, 3, 4],
          outputRange: [0, 0.5, 1, 0.92, 0.7, 0.4, 0],
          extrapolate: "clamp",
        });

        return (
          <Animated.View
            key={doc.id}
            style={[
              styles.card,
              {
                transform: [{ translateY }, { scale }],
                opacity,
                // zIndex is not animatable on the native driver, so it is
                // derived from committed state. It only needs to be right at
                // rest, which is when a card can be tapped.
                zIndex: documents.length - Math.abs(i - active),
              },
            ]}
            // Only the front card is reachable; the rest are decoration until
            // brought forward, and exposing them all would give a screen
            // reader a pile of unreachable buttons.
            accessibilityElementsHidden={i !== active}
            importantForAccessibility={i === active ? "yes" : "no-hide-descendants"}
            pointerEvents={i === active ? "auto" : "none"}
          >
            <PassportCard
              doc={doc}
              animated={i === active}
              onPress={onPressDocument ? () => onPressDocument(doc) : undefined}
            />
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { marginHorizontal: spacing.md },
  card: { position: "absolute", left: 0, right: 0, top: 0 },
});

export default PassportCardStack;
