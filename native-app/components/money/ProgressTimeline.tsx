import React, { useEffect, useRef } from "react";
import { Animated, Linking, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { ExecutionStage } from "@/lib/execution";
import { CHAINS, type ChainId } from "@/lib/swap/assets";
import { colors, radius, spacing, type } from "@/lib/theme";

// Execution timeline, shared by swap and send.
//
// THE STAGES SHOWN ARE THE STAGES THAT EXIST. /api/swaps and
// /api/wallets/transfer each perform one round trip; only the transfer returns
// a transaction hash. So this renders three honest steps, and an explorer link
// appears only on the step that actually has a hash. `txHash` is rendered the
// moment a rail returns one — but a "View on explorer" link that resolves to
// nothing is a receipt for a transaction that never happened, so the link and
// the hash are strictly coupled. Nothing here invents a step to make the wait
// feel busier.

export interface TimelineStep {
  id: string;
  title: string;
  /** Shown under the title while the step is active or after it completes. */
  detail?: string;
  /** Rendered as an explorer link only when present. */
  txHash?: string;
  chain?: ChainId;
}

type StepState = "pending" | "active" | "done" | "failed";

export function ProgressTimeline({
  stage,
  steps,
  failedAt,
}: {
  stage: ExecutionStage;
  steps: TimelineStep[];
  /** Index of the step that failed, when stage is "failed". */
  failedAt?: number;
}) {
  const activeIndex = indexForStage(stage, steps.length);
  // Steps BEFORE the one that failed did succeed, and must read that way — a
  // timeline that marks a completed biometric approval as "not started" tells
  // the user the wrong story about where their money got to.
  const failedIndex = stage === "failed" ? (failedAt ?? activeIndex) : -1;

  return (
    <View style={styles.wrap} accessibilityRole="progressbar">
      {steps.map((step, i) => {
        const state: StepState =
          i === failedIndex
            ? "failed"
            : stage === "failed"
              ? i < failedIndex
                ? "done"
                : "pending"
              : i < activeIndex || stage === "settled"
                ? "done"
                : i === activeIndex
                  ? "active"
                  : "pending";
        return (
          <Step key={step.id} step={step} state={state} last={i === steps.length - 1} />
        );
      })}
    </View>
  );
}

function indexForStage(stage: ExecutionStage, count: number): number {
  switch (stage) {
    case "authorizing":
      return 0;
    case "submitting":
      return 1;
    case "settled":
      return count;
    default:
      return 0;
  }
}

function Step({ step, state, last }: { step: TimelineStep; state: StepState; last: boolean }) {
  const pulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (state !== "active") {
      pulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 800, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 800, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [state, pulse]);

  const dotColor =
    state === "failed" ? colors.accent : state === "pending" ? colors.border : colors.neon;
  const explorer = step.chain ? CHAINS[step.chain].explorerTx : undefined;
  const link = explorer && step.txHash ? explorer + step.txHash : undefined;

  return (
    <View style={styles.step}>
      <View style={styles.rail}>
        <Animated.View
          style={[
            styles.dot,
            { backgroundColor: dotColor, opacity: state === "active" ? pulse.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] }) : 1 },
          ]}
        >
          {state === "done" ? (
            <Ionicons name="checkmark" size={12} color={colors.onNeon} />
          ) : state === "failed" ? (
            <Ionicons name="close" size={12} color="#FFFFFF" />
          ) : null}
        </Animated.View>
        {!last ? (
          <View
            style={[
              styles.connector,
              { backgroundColor: state === "done" ? colors.neon : colors.border },
            ]}
          />
        ) : null}
      </View>

      <View style={styles.body}>
        <Text
          style={[
            styles.title,
            state === "pending" && { color: colors.textFaint },
            state === "failed" && { color: colors.accent },
          ]}
          accessibilityLabel={`${step.title}: ${state}`}
        >
          {step.title}
        </Text>
        {step.detail && state !== "pending" ? (
          <Text style={type.dim}>{step.detail}</Text>
        ) : null}

        {link ? (
          <Pressable
            onPress={() => void Linking.openURL(link)}
            style={styles.link}
            accessibilityRole="link"
            accessibilityLabel={`View transaction on ${CHAINS[step.chain!].name} explorer`}
          >
            <Text style={styles.linkText}>
              {step.txHash!.slice(0, 10)}…{step.txHash!.slice(-8)}
            </Text>
            <Ionicons name="open-outline" size={13} color={colors.neon} />
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/**
 * The three stages the SEND rail actually has.
 *
 * `txHash` is threaded in from the transfer response, so the settle step gains
 * a real explorer link the moment one exists and shows none before that.
 */
export function sendSteps(chain: ChainId, txHash?: string): TimelineStep[] {
  return [
    {
      id: "authorize",
      title: "Confirm it's you",
      detail: "Approved with your device biometrics",
    },
    {
      id: "submit",
      title: "Submitting the payment",
      detail: `Sending on ${CHAINS[chain].name}`,
      chain,
    },
    {
      id: "settle",
      title: "Settling",
      detail: "The recipient's balance updates once the network confirms",
      chain,
      txHash,
    },
  ];
}

/** The three stages the SWAP rail actually has. */
export function swapSteps(fromChain: ChainId, toChain: ChainId): TimelineStep[] {
  const crossChain = fromChain !== toChain;
  return [
    {
      id: "authorize",
      title: "Confirm it's you",
      detail: "Approved with your device biometrics",
    },
    {
      id: "submit",
      title: "Submitting the swap",
      detail: `Executing the quote you approved on ${CHAINS[fromChain].name}`,
      chain: fromChain,
    },
    {
      id: "settle",
      title: crossChain ? `Settling on ${CHAINS[toChain].name}` : "Settling",
      detail: crossChain
        ? "Funds arrive once the bridge confirms on the destination chain"
        : "Balances updated",
      chain: toChain,
    },
  ];
}

const styles = StyleSheet.create({
  wrap: {
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  step: { flexDirection: "row", gap: spacing.md },
  rail: { alignItems: "center", width: 20 },
  dot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  connector: { width: 2, flex: 1, minHeight: 24, marginVertical: 2 },
  body: { flex: 1, paddingBottom: spacing.md, gap: 2 },
  title: { color: colors.text, fontSize: 14, fontWeight: "600" },
  link: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 4 },
  linkText: { color: colors.neon, fontSize: 12, fontFamily: "monospace" },
});
