import React, { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import {
  createWallet,
  deleteWallet,
  getAddress,
  hasWallet,
  importWallet,
  revealMnemonic,
  sendGasless,
  type GaslessResult,
} from "@/lib/wallet";
import { useSecureScreen } from "@/lib/secureScreen";
import { isValidDestination, shortAddress, usd } from "@/lib/format";
import { colors, radius, spacing, type } from "@/lib/theme";
import { Button, ErrorNote, Field, Screen, SectionHeader, Sheet, Surface } from "@/components/ui";

// Self-custodial wallet: a real secp256k1 key held in the Android Keystore
// (lib/wallet.ts). The seed phrase is shown only behind the biometric gate and
// under FLAG_SECURE so it can't be screenshotted. Sends sign a real EIP-3009
// authorization and relay through /api/transfers/gasless.

export default function Wallet() {
  useSecureScreen("wallet"); // key material + seed phrase live here
  const [exists, setExists] = useState<boolean | null>(null);
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Sheets
  const [backup, setBackup] = useState<string[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [phrase, setPhrase] = useState("");
  const [sending, setSending] = useState(false);

  const refresh = useCallback(async () => {
    const has = await hasWallet();
    setExists(has);
    setAddress(has ? await getAddress().catch(() => null) : null);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onCreate = async () => {
    setError(null);
    setBusy(true);
    try {
      const { mnemonic, address } = await createWallet();
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAddress(address);
      setExists(true);
      setBackup(mnemonic.split(" ")); // force the backup step immediately
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onReveal = async () => {
    setError(null);
    try {
      const m = await revealMnemonic(); // biometric gate
      setBackup(m.split(" "));
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const onImport = async () => {
    setError(null);
    setBusy(true);
    try {
      const { address } = await importWallet(phrase);
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setAddress(address);
      setExists(true);
      setImporting(false);
      setPhrase("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const onDelete = () => {
    Alert.alert(
      "Remove wallet from this device?",
      "You can only restore it with your recovery phrase. Without that phrase, funds at this address are lost forever.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: async () => {
            await deleteWallet();
            await refresh();
          },
        },
      ]
    );
  };

  const copy = async () => {
    if (!address) return;
    await Clipboard.setStringAsync(address);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  if (exists === null) return <Screen />;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {!exists ? (
          <>
            <Surface style={{ gap: spacing.sm }}>
              <Text style={[type.body, { fontWeight: "700" }]}>Create your self-custodial wallet</Text>
              <Text style={type.dim}>
                A private key is generated on this device and stored in secure hardware, unlocked by
                your fingerprint. FurlPay never sees it. You get a recovery phrase to back it up.
              </Text>
            </Surface>
            <Button title="Create wallet" loading={busy} onPress={() => void onCreate()} />
            <Button title="Import a recovery phrase" variant="secondary" onPress={() => setImporting(true)} />
          </>
        ) : (
          <>
            <Surface style={{ gap: 4 }}>
              <Text style={type.dim}>Your wallet address</Text>
              <Text style={type.mono} selectable>
                {address ?? "—"}
              </Text>
              <Text style={[type.dim, { fontSize: 12 }]}>
                Receive USDC to this address on Arbitrum. It is controlled only by the key on this device.
              </Text>
            </Surface>
            <View style={{ flexDirection: "row", gap: spacing.sm }}>
              <Button title="Copy" variant="secondary" onPress={() => void copy()} style={{ flex: 1 }} />
              <Button title="Send USDC" onPress={() => setSending(true)} style={{ flex: 1 }} />
            </View>

            <SectionHeader title="Security" />
            <Surface style={{ paddingVertical: 4 }}>
              <NavRow icon="key-outline" label="Reveal recovery phrase" onPress={() => void onReveal()} />
              <NavRow icon="trash-outline" label="Remove wallet from device" danger onPress={onDelete} />
            </Surface>
            <Text style={[type.dim, { fontSize: 12 }]}>
              Real transfers require FurlPay&apos;s relayer to be live. Until then a send signs your
              authorization and reports honestly that settlement is unavailable — it never fakes a
              transfer.
            </Text>
          </>
        )}
        <ErrorNote message={error} />
      </ScrollView>

      {backup ? <BackupSheet words={backup} onClose={() => setBackup(null)} /> : null}
      {importing ? (
        <Sheet open title="Import recovery phrase" onClose={() => setImporting(false)}>
          <View style={{ gap: spacing.sm }}>
            <Field
              label="12 or 24 words, space-separated"
              value={phrase}
              onChangeText={setPhrase}
              placeholder="word1 word2 word3 …"
              autoCapitalize="none"
              autoCorrect={false}
              multiline
              numberOfLines={3}
            />
            <Button title="Import" loading={busy} onPress={() => void onImport()} />
          </View>
        </Sheet>
      ) : null}
      {sending && address ? <SendSheet from={address} onClose={() => setSending(false)} /> : null}
    </Screen>
  );
}

function BackupSheet({ words, onClose }: { words: string[]; onClose: () => void }) {
  const [saved, setSaved] = useState(false);
  return (
    <Sheet open title="Your recovery phrase" onClose={onClose}>
      <View style={{ gap: spacing.md }}>
        <Text style={type.dim}>
          Write these {words.length} words down in order and keep them offline. Anyone with them
          controls your funds. FurlPay cannot recover them for you.
        </Text>
        <View style={styles.words}>
          {words.map((w, i) => (
            <View key={i} style={styles.word}>
              <Text style={[type.dim, { fontSize: 11 }]}>{i + 1}</Text>
              <Text style={type.body}>{w}</Text>
            </View>
          ))}
        </View>
        <Pressable onPress={() => setSaved((s) => !s)} style={styles.check}>
          <Ionicons name={saved ? "checkbox" : "square-outline"} size={20} color={colors.neon} />
          <Text style={type.body}>I have written down my recovery phrase</Text>
        </Pressable>
        <Button title="Done" disabled={!saved} onPress={onClose} />
      </View>
    </Sheet>
  );
}

function SendSheet({ from, onClose }: { from: string; onClose: () => void }) {
  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<GaslessResult | null>(null);

  const valid =
    isValidDestination(to.trim(), "arbitrum") && Number(amount) > 0;

  const send = async () => {
    setError(null);
    setBusy(true);
    try {
      const r = await sendGasless(to.trim(), amount.trim()); // biometric gate on signing
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setResult(r);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open title="Send USDC" onClose={onClose}>
      {result ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={[type.body, { fontWeight: "700" }]}>
            {result.kind === "settled"
              ? "Sent"
              : result.kind === "pending"
                ? "Submitted — confirming"
                : result.kind === "simulated"
                  ? "Signed (simulated settlement)"
                  : "Settlement unavailable"}
          </Text>
          <Text style={type.dim}>
            {result.kind === "settled" || result.kind === "pending"
              ? `Transaction ${shortAddress(result.transaction, 10)}`
              : result.kind === "simulated"
                ? "Your authorization was signed and accepted, but the server is not in live mode, so no on-chain transfer occurred."
                : result.detail}
          </Text>
          <Button title="Done" onPress={onClose} />
        </View>
      ) : (
        <View style={{ gap: spacing.sm }}>
          <Text style={[type.dim, { fontSize: 12 }]}>From {shortAddress(from, 8)} · Arbitrum · gas sponsored</Text>
          <Field
            label="Recipient (0x address)"
            value={to}
            onChangeText={setTo}
            placeholder="0x…"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Field label="Amount (USDC)" value={amount} onChangeText={setAmount} placeholder="0.00" keyboardType="decimal-pad" />
          <Button title="Sign & send" loading={busy} disabled={!valid} onPress={() => void send()} />
          <ErrorNote message={error} />
        </View>
      )}
    </Sheet>
  );
}

function NavRow({
  icon,
  label,
  danger,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  danger?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.navRow, pressed && { opacity: 0.7 }]}>
      <Ionicons name={icon} size={18} color={danger ? colors.accent : colors.neon} />
      <Text style={[type.body, { flex: 1, color: danger ? colors.accent : colors.text }]}>{label}</Text>
      <Ionicons name="chevron-forward" size={16} color={colors.textFaint} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  navRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingVertical: 12 },
  words: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  word: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    paddingHorizontal: 10,
    paddingVertical: 6,
    minWidth: "30%",
  },
  check: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
});
