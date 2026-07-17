import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Animated,
  AppState,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useRouter } from "expo-router";
import { colors, radius, spacing, type } from "@/lib/theme";
import { Button, Screen, SectionHeader, Surface } from "@/components/ui";
import { haptic } from "@/lib/haptics";
import {
  bridgeAvailable,
  getConnectedWatches,
  getPairedWatchName,
  isGuardianInstalled,
  openGuardianOrStore,
  setPairedWatchName,
  type WatchNode,
} from "@/lib/watch";

// ---------------------------------------------------------------------------
// Connect to Watch. Every state is REAL:
//   searching   polling NodeClient for paired watches
//   found       a watch node is paired & nearby — one-tap connect
//   connecting  hand-off to the Guardian companion app (it owns the Data
//               Layer sync; see lib/watch.ts for why it must)
//   connected   persisted + re-verified on every focus
//   unavailable no bridge (Expo Go / stale build) — say so, don't fake radar
// ---------------------------------------------------------------------------

type WatchState = "searching" | "found" | "connecting" | "connected" | "unavailable";

const POLL_MS = 3000;

export default function WatchScreen() {
  const router = useRouter();
  const [state, setState] = useState<WatchState>(bridgeAvailable ? "searching" : "unavailable");
  const [watch, setWatch] = useState<WatchNode | null>(null);
  const [guardianInstalled, setGuardianInstalled] = useState(isGuardianInstalled());
  const [guardianOpened, setGuardianOpened] = useState(false);
  const stateRef = useRef(state);
  stateRef.current = state;

  // Restore a previously completed connection, then keep verifying it.
  useEffect(() => {
    void (async () => {
      const paired = await getPairedWatchName();
      if (paired && bridgeAvailable) {
        setWatch({ id: "restored", name: paired, isNearby: false });
        setState("connected");
      }
    })();
  }, []);

  // Poll for watch nodes while searching; refresh nearby status otherwise.
  useEffect(() => {
    if (!bridgeAvailable) return;
    let cancelled = false;

    const probe = async () => {
      const nodes = await getConnectedWatches();
      if (cancelled) return;
      const best = nodes.find((n) => n.isNearby) ?? nodes[0] ?? null;
      if (best) {
        setWatch((prev) => (prev?.id === best.id && prev.name === best.name ? prev : best));
        if (stateRef.current === "searching") {
          haptic.found();
          setState("found");
        }
      } else if (stateRef.current === "found") {
        haptic.warning();
        setState("searching");
      }
    };

    void probe();
    const interval = setInterval(() => void probe(), POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Returning from the Guardian hand-off: re-check installs and complete.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active" || stateRef.current !== "connecting") return;
      const installed = isGuardianInstalled();
      setGuardianInstalled(installed);
      if (installed && guardianOpened && watch) {
        void setPairedWatchName(watch.name);
        haptic.success();
        setState("connected");
      }
    });
    return () => sub.remove();
  }, [guardianOpened, watch]);

  const handleConnect = useCallback(async () => {
    if (!watch) return;
    haptic.commit();
    setState("connecting");
    const result = await openGuardianOrStore();
    setGuardianOpened(result === "opened");
    // "store": the user is installing Guardian; the AppState listener picks
    // the flow back up when they return with it installed.
  }, [watch]);

  const handleDisconnect = useCallback(() => {
    haptic.warning();
    void setPairedWatchName(null);
    setGuardianOpened(false);
    setState("searching");
  }, []);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.container}>
        <View style={styles.header}>
          <Pressable
            onPress={() => {
              haptic.tap();
              router.back();
            }}
            hitSlop={12}
          >
            <Ionicons name="arrow-back" size={24} color={colors.text} />
          </Pressable>
          <Text style={type.h2}>{state === "connected" ? "Watch connected" : "Connect watch"}</Text>
          <View style={{ width: 24 }} />
        </View>

        {state === "unavailable" && <UnavailableBody />}
        {state === "searching" && <SearchingBody />}
        {state === "found" && watch && <FoundBody watch={watch} onConnect={handleConnect} />}
        {state === "connecting" && (
          <ConnectingBody
            watch={watch}
            guardianInstalled={guardianInstalled}
            guardianOpened={guardianOpened}
            onRetry={handleConnect}
          />
        )}
        {state === "connected" && watch && (
          <ConnectedBody watch={watch} onDisconnect={handleDisconnect} />
        )}
      </ScrollView>
    </Screen>
  );
}

// ── Searching: pulsing radar ────────────────────────────────────────────────

function PulsingRadar() {
  const rings = [useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current, useRef(new Animated.Value(0)).current];

  useEffect(() => {
    const loops = rings.map((ring, i) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(i * 600),
          Animated.timing(ring, {
            toValue: 1,
            duration: 1800,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }),
          Animated.timing(ring, { toValue: 0, duration: 0, useNativeDriver: true }),
        ]),
      ),
    );
    loops.forEach((l) => l.start());
    return () => loops.forEach((l) => l.stop());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.radar}>
      {rings.map((ring, i) => (
        <Animated.View
          key={i}
          style={[
            styles.radarRing,
            {
              opacity: ring.interpolate({ inputRange: [0, 1], outputRange: [0.55, 0] }),
              transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1.4] }) }],
            },
          ]}
        />
      ))}
      <View style={styles.radarCenter}>
        <Ionicons name="watch-outline" size={44} color={colors.neon} />
      </View>
    </View>
  );
}

function SearchingBody() {
  return (
    <View style={styles.center}>
      <PulsingRadar />
      <Text style={[type.body, styles.centerText, { marginTop: 28, fontWeight: "700" }]}>
        Looking for your watch…
      </Text>
      <Text style={[type.dim, styles.centerText, { marginTop: 6 }]}>
        Keep the watch nearby and paired to this phone{"\n"}(Pixel Watch, Galaxy Watch — Wear OS 4+)
      </Text>
    </View>
  );
}

function UnavailableBody() {
  return (
    <View style={styles.center}>
      <Ionicons name="watch-outline" size={44} color={colors.textFaint} style={{ marginTop: 32 }} />
      <Text style={[type.body, styles.centerText, { marginTop: 16, fontWeight: "700" }]}>
        Watch support isn't in this build
      </Text>
      <Text style={[type.dim, styles.centerText, { marginTop: 6 }]}>
        Update FurlPay from the Play Store to pair a Wear OS watch. (Development builds need a
        rebuild with the wear-bridge module.)
      </Text>
    </View>
  );
}

// ── Found: spring-in card + one-tap connect ────────────────────────────────

function SpringIn({ children, stretch }: { children: React.ReactNode; stretch?: boolean }) {
  const reveal = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(reveal, {
      toValue: 1,
      damping: 14,
      stiffness: 140,
      useNativeDriver: true,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Animated.View
      style={{
        alignSelf: stretch ? "stretch" : undefined,
        opacity: reveal,
        transform: [
          { translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [24, 0] }) },
          { scale: reveal.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
        ],
      }}
    >
      {children}
    </Animated.View>
  );
}

function FoundBody({ watch, onConnect }: { watch: WatchNode; onConnect: () => void }) {
  return (
    <View style={styles.center}>
      <SpringIn>
        <View style={styles.foundIcon}>
          <View style={styles.radarCenter}>
            <Ionicons name="watch" size={44} color={colors.neon} />
          </View>
          <View style={styles.foundBadge}>
            <Ionicons name="checkmark-circle" size={26} color={colors.neon} />
          </View>
        </View>
      </SpringIn>
      <Text style={[type.h2, styles.centerText, { marginTop: 16 }]}>{watch.name}</Text>
      <Text style={[type.dim, styles.centerText, { marginTop: 4 }]}>
        {watch.isNearby ? "Paired · nearby" : "Paired"}
      </Text>

      <SpringIn stretch>
        <Surface style={styles.watchCard}>
          <View style={styles.watchCardRow}>
            <Ionicons name="watch" size={30} color={colors.neon} />
            <View style={{ marginLeft: 12, flex: 1 }}>
              <Text style={[type.body, { fontWeight: "700" }]}>{watch.name}</Text>
              <Text style={type.dim}>Wear OS · ready to connect</Text>
            </View>
          </View>
        </Surface>
      </SpringIn>

      <Button title="Connect with one tap" onPress={onConnect} style={{ marginTop: 20, alignSelf: "stretch" }} />
      <Text style={[type.dim, styles.centerText, { marginTop: 10, fontSize: 12 }]}>
        This sets up FurlPay Guardian — balances, card freeze, alarms, and voice on your wrist.
      </Text>
    </View>
  );
}

// ── Connecting: real checklist (no fake percentages) ───────────────────────

function ConnectingBody({
  watch,
  guardianInstalled,
  guardianOpened,
  onRetry,
}: {
  watch: WatchNode | null;
  guardianInstalled: boolean;
  guardianOpened: boolean;
  onRetry: () => void;
}) {
  const steps = [
    { label: "Watch paired", done: watch != null },
    { label: "Guardian companion installed", done: guardianInstalled },
    { label: "Guardian opened — finish sign-in there", done: guardianOpened },
  ];
  return (
    <View style={styles.center}>
      <View style={styles.pairRow}>
        <Ionicons name="watch" size={34} color={colors.neon} />
        <Text style={[type.dim, { marginHorizontal: 10 }]}>↔</Text>
        <Ionicons name="phone-portrait" size={34} color={colors.neon} />
      </View>
      <Text style={[type.body, styles.centerText, { marginTop: 16, fontWeight: "700" }]}>
        Setting up your watch
      </Text>

      <View style={styles.checklist}>
        {steps.map((step, index) => (
          <StaggeredCheckItem key={step.label} index={index} label={step.label} done={step.done} />
        ))}
      </View>

      <Text style={[type.dim, styles.centerText, { marginTop: 16, fontSize: 12 }]}>
        Sign in inside FurlPay Guardian, tap “Sync watch”, then come back here.
      </Text>
      <Button title="Reopen Guardian" variant="outline" onPress={onRetry} style={{ marginTop: 16, alignSelf: "stretch" }} />
    </View>
  );
}

function StaggeredCheckItem({ index, label, done }: { index: number; label: string; done: boolean }) {
  const reveal = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(reveal, {
      toValue: 1,
      duration: 300,
      delay: index * 120,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const wasDone = useRef(done);
  useEffect(() => {
    if (done && !wasDone.current) haptic.select();
    wasDone.current = done;
  }, [done]);
  return (
    <Animated.View
      style={[
        styles.checkItem,
        {
          opacity: reveal,
          transform: [{ translateX: reveal.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) }],
        },
      ]}
    >
      <Ionicons
        name={done ? "checkmark-circle" : "ellipse-outline"}
        size={20}
        color={done ? colors.neon : colors.textFaint}
      />
      <Text style={[done ? type.body : type.dim, { marginLeft: 10 }]}>{label}</Text>
    </Animated.View>
  );
}

// ── Connected: staggered feature grid ──────────────────────────────────────

const FEATURES = [
  { icon: "shield-checkmark-outline", title: "Guardian AI", text: "Escalating alarms until you acknowledge." },
  { icon: "wallet-outline", title: "Wallet", text: "Balances across currencies at a glance." },
  { icon: "lock-closed-outline", title: "Card controls", text: "Freeze your card from the wrist." },
  { icon: "airplane-outline", title: "Travel", text: "Next trip and countdown on a tile." },
  { icon: "mic-outline", title: "Voice", text: "“Check my balance” — hands free." },
  { icon: "trending-up-outline", title: "Portfolio", text: "Day P&L, green or red, instantly." },
] as const;

function ConnectedBody({ watch, onDisconnect }: { watch: WatchNode; onDisconnect: () => void }) {
  return (
    <View>
      <View style={[styles.center, { paddingTop: 8 }]}>
        <SpringIn>
          <Ionicons name="checkmark-circle" size={52} color={colors.neon} />
        </SpringIn>
        <Text style={[type.h2, { marginTop: 10 }]}>{watch.name}</Text>
        <Text style={type.dim}>Connected via FurlPay Guardian</Text>
      </View>

      <SectionHeader title="On your wrist" />
      <View style={styles.featureGrid}>
        {FEATURES.map((feature, index) => (
          <StaggeredFeatureCard key={feature.title} index={index} {...feature} />
        ))}
      </View>

      <Button
        title="Open Guardian"
        onPress={() => {
          haptic.tap();
          void openGuardianOrStore();
        }}
        style={{ marginTop: 20 }}
      />
      <Button title="Disconnect watch" variant="outline" onPress={onDisconnect} style={{ marginTop: 10 }} />
    </View>
  );
}

function StaggeredFeatureCard({
  index,
  icon,
  title,
  text,
}: {
  index: number;
  icon: (typeof FEATURES)[number]["icon"];
  title: string;
  text: string;
}) {
  const reveal = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.spring(reveal, {
      toValue: 1,
      damping: 16,
      stiffness: 130,
      delay: index * 70,
      useNativeDriver: true,
    }).start();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <Animated.View
      style={[
        styles.featureCardWrap,
        {
          opacity: reveal,
          transform: [{ translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }) }],
        },
      ]}
    >
      <Surface style={styles.featureCard}>
        <Ionicons name={icon} size={22} color={colors.neon} />
        <Text style={[type.body, { fontWeight: "700", marginTop: 8 }]}>{title}</Text>
        <Text style={[type.dim, { marginTop: 4, fontSize: 12 }]}>{text}</Text>
      </Surface>
    </Animated.View>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: { padding: spacing.lg, paddingBottom: 96 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.lg,
  },
  center: { alignItems: "center", paddingTop: 24 },
  centerText: { textAlign: "center" },
  radar: { width: 190, height: 190, justifyContent: "center", alignItems: "center" },
  radarRing: {
    position: "absolute",
    width: 190,
    height: 190,
    borderRadius: 95,
    borderWidth: 2,
    borderColor: colors.neon,
  },
  radarCenter: {
    width: 84,
    height: 84,
    borderRadius: 42,
    backgroundColor: colors.neonSoft,
    justifyContent: "center",
    alignItems: "center",
  },
  foundIcon: { position: "relative" },
  foundBadge: {
    position: "absolute",
    bottom: -4,
    right: -8,
    backgroundColor: colors.bg,
    borderRadius: 13,
  },
  watchCard: {
    marginTop: 20,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.neon + "40",
    alignSelf: "stretch",
  },
  watchCardRow: { flexDirection: "row", alignItems: "center" },
  pairRow: { flexDirection: "row", alignItems: "center", marginTop: 28 },
  checklist: { marginTop: 20, alignSelf: "stretch", gap: 12 },
  checkItem: { flexDirection: "row", alignItems: "center" },
  featureGrid: { flexDirection: "row", flexWrap: "wrap", gap: 12 },
  featureCardWrap: { width: "47.5%" },
  featureCard: { padding: spacing.md, borderRadius: radius.md, minHeight: 118 },
});
