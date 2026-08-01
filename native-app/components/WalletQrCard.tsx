import React, { useRef, useState } from "react";
import { Linking, Pressable, Share, StyleSheet, Text, View } from "react-native";
import QRCode from "react-native-qrcode-svg";
import * as Clipboard from "expo-clipboard";
import * as Haptics from "expo-haptics";
import { Ionicons } from "@expo/vector-icons";
import { TelegramGlyph, WhatsAppGlyph, XGlyph } from "@/components/BrandGlyphs";
import { colors, radius, spacing, type } from "@/lib/theme";

// Shareable "My QR" receive card — the native counterpart of the web's
// ScanToPay MyQrView (apps/web/src/components/ScanToPay.tsx).
//
// WHAT IS COPIED FROM THE WEB: the layout (avatar, QR, copyable short address),
// Save / Share actions, and the WhatsApp / Telegram / X social row with the
// real brand marks.
//
// WHAT IS DELIBERATELY NOT COPIED: the address source. The web card shares
// `user.safeAddress`; on native that value is a sha256-derived placeholder no
// private key controls, and funds sent to it are unrecoverable — receive.tsx
// documents this and lib/__tests__/receiveSafety.test.ts enforces it. This
// component therefore takes the address as a prop and the caller passes the
// DEVICE-WALLET address. The share UX is copied; the money-losing binding is not.
//
// NO NEW NATIVE MODULES. Text share uses React Native's built-in Share (already
// used in rewards.tsx); social buttons use Linking; the "Save as image" path
// uses the QR's own SVG ref and only reaches for expo-file-system inside a
// try/catch, degrading to a text share if that module isn't linked. So nothing
// here forces a native rebuild that would invalidate the signed AAB.

const SHARE_PROMPT = "Pay me on FurlPay";

function shortAddr(a: string): string {
  return a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-6)}` : a;
}

export function WalletQrCard({
  name = "My wallet",
  address,
  /** Asset/network line shown above the card, e.g. "USDC · Arbitrum One". */
  rail,
}: {
  /** Optional. Defaults to a neutral label so this component pulls no PII and
   *  receive.tsx stays clear of the overview/profile reads its safety test bans. */
  name?: string;
  address: string;
  rail?: string;
}) {
  const [copied, setCopied] = useState(false);
  // react-native-svg ref; its .toDataURL(cb) yields base64 PNG. Typed any
  // because react-native-qrcode-svg types getRef's argument as any.
  const qrRef = useRef<{ toDataURL?: (cb: (b64: string) => void) => void } | null>(null);

  const shareText = `${SHARE_PROMPT} — my wallet address: ${address}`;
  const initial = name.trim().charAt(0).toUpperCase() || "U";

  const copy = async () => {
    await Clipboard.setStringAsync(address);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const shareText_ = async () => {
    try {
      await Share.share({ message: shareText });
    } catch {
      /* user dismissed the sheet */
    }
  };

  // Best-effort image save/share. Writes the QR PNG to a temp file and opens the
  // share sheet on it (which offers "Save to Photos"/"Files"). If image capture
  // or the file module is unavailable, falls back to sharing the address text —
  // never throws, never a dead button.
  const saveImage = () => {
    const ref = qrRef.current;
    if (!ref?.toDataURL) return void shareText_();
    ref.toDataURL(async (b64) => {
      try {
        // Dynamically required so an unlinked module degrades instead of
        // crashing at import time.
        const FileSystem = require("expo-file-system") as typeof import("expo-file-system");
        const uri = `${FileSystem.cacheDirectory}furlpay-qr.png`;
        await FileSystem.writeAsStringAsync(uri, b64, {
          encoding: FileSystem.EncodingType.Base64,
        });
        await Share.share({ url: uri, message: shareText });
      } catch {
        await shareText_();
      }
    });
  };

  const socials: {
    label: string;
    bg: string;
    glyph: React.ReactNode;
    url: string;
  }[] = [
    {
      label: "WhatsApp",
      bg: "#25D366",
      glyph: <WhatsAppGlyph />,
      url: `whatsapp://send?text=${encodeURIComponent(shareText)}`,
    },
    {
      label: "Telegram",
      bg: "#229ED9",
      glyph: <TelegramGlyph />,
      url: `https://t.me/share/url?url=${encodeURIComponent(address)}&text=${encodeURIComponent(SHARE_PROMPT)}`,
    },
    {
      label: "X",
      bg: "#111214",
      glyph: <XGlyph />,
      url: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}`,
    },
  ];

  const openSocial = async (url: string, fallbackToSheet: boolean) => {
    void Haptics.selectionAsync();
    try {
      const ok = await Linking.canOpenURL(url);
      // WhatsApp's whatsapp:// scheme fails when the app isn't installed; fall
      // back to the OS share sheet rather than a silent no-op.
      if (ok) return void Linking.openURL(url);
      if (fallbackToSheet) return void shareText_();
      await Linking.openURL(url); // https targets open in a browser regardless
    } catch {
      if (fallbackToSheet) void shareText_();
    }
  };

  return (
    <View style={styles.wrap}>
      {rail ? (
        <View style={styles.rail}>
          <Text style={styles.railText}>{rail}</Text>
        </View>
      ) : null}

      {/* QR card */}
      <View style={styles.card}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
        <Text style={styles.name}>{name}</Text>
        <Text style={type.dim}>Scan with any wallet or FurlPay</Text>

        <View style={styles.qrPlate}>
          <QRCode
            value={address}
            size={208}
            backgroundColor="#FFFFFF"
            color="#000000"
            getRef={(c: unknown) => {
              qrRef.current = c as { toDataURL?: (cb: (b64: string) => void) => void } | null;
            }}
          />
        </View>

        <Pressable onPress={() => void copy()} style={styles.copyChip} accessibilityRole="button" accessibilityLabel="Copy full address">
          <Text style={styles.copyText}>{shortAddr(address)}</Text>
          <Ionicons
            name={copied ? "checkmark" : "copy-outline"}
            size={14}
            color={copied ? colors.neon : colors.textDim}
          />
        </Pressable>
      </View>

      {/* Save / Share */}
      <View style={styles.actionRow}>
        <Pressable onPress={saveImage} style={[styles.action, styles.actionSecondary]} accessibilityRole="button" accessibilityLabel="Save QR image">
          <Ionicons name="download-outline" size={17} color={colors.text} />
          <Text style={styles.actionLabel}>Save</Text>
        </Pressable>
        <Pressable onPress={() => void shareText_()} style={[styles.action, styles.actionPrimary]} accessibilityRole="button" accessibilityLabel="Share address">
          <Ionicons name="share-social-outline" size={17} color={colors.onNeon} />
          <Text style={[styles.actionLabel, { color: colors.onNeon }]}>Share</Text>
        </Pressable>
      </View>

      {/* Social share */}
      <View style={styles.socialRow}>
        {socials.map((s) => (
          <Pressable
            key={s.label}
            onPress={() => void openSocial(s.url, s.label === "WhatsApp")}
            style={styles.social}
            accessibilityRole="button"
            accessibilityLabel={`Share on ${s.label}`}
          >
            <View style={[styles.socialCircle, { backgroundColor: s.bg }]}>{s.glyph}</View>
            <Text style={styles.socialLabel}>{s.label}</Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: spacing.lg, alignSelf: "stretch" },
  rail: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  railText: { color: colors.neon, fontWeight: "700", fontSize: 13 },
  card: {
    alignItems: "center",
    alignSelf: "stretch",
    gap: 4,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xl,
    paddingBottom: spacing.lg,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatar: {
    height: 52,
    width: 52,
    borderRadius: 26,
    backgroundColor: colors.neon,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  avatarText: { color: colors.onNeon, fontSize: 20, fontWeight: "800" },
  name: { color: colors.text, fontSize: 17, fontWeight: "700" },
  qrPlate: { marginTop: spacing.md, backgroundColor: "#FFFFFF", padding: 12, borderRadius: radius.md },
  copyChip: {
    marginTop: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: colors.surfaceRaised,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: radius.pill,
  },
  copyText: { color: colors.textDim, fontFamily: "monospace", fontSize: 12 },
  actionRow: { flexDirection: "row", gap: spacing.sm, alignSelf: "stretch" },
  action: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    borderRadius: radius.pill,
  },
  actionSecondary: { backgroundColor: colors.surfaceRaised, borderWidth: 1, borderColor: colors.border },
  actionPrimary: { backgroundColor: colors.neon },
  actionLabel: { color: colors.text, fontSize: 14, fontWeight: "700" },
  socialRow: { flexDirection: "row", gap: spacing.xl },
  social: { alignItems: "center", gap: 6 },
  socialCircle: { height: 44, width: 44, borderRadius: 22, alignItems: "center", justifyContent: "center" },
  socialLabel: { color: colors.textDim, fontSize: 11 },
});

export default WalletQrCard;
