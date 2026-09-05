import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import { AmountInput } from "@/components/money/AmountInput";
import { ProgressTimeline, sendSteps } from "@/components/money/ProgressTimeline";
import { SwipeToConfirm } from "@/components/money/SwipeToConfirm";
import { ValuePanel } from "@/components/money/ValuePanel";
import { WarningList } from "@/components/money/WarningList";
import { ContactPickerSheet } from "@/components/contacts/ContactPickerSheet";
import { NameResolution } from "@/components/send/NameResolution";
import { RecipientInput } from "@/components/send/RecipientInput";
import { SendSummary } from "@/components/send/SendSummary";
import { SourceSelector } from "@/components/send/SourceSelector";
import { Button, ErrorNote, Field, Screen } from "@/components/ui";
import { useContactForAddress } from "@/lib/contacts/useContacts";
import { useNameResolution } from "@/lib/contacts/useResolveName";
import { shortAddress, usd } from "@/lib/format";
import { canUserRetry, isTerminalState } from "@/lib/money/transactionState";
import {
  AMOUNT_MAX_LENGTH,
  assetForToken,
  chainName,
  useClipboardPaste,
  useRecipients,
  useSendBalances,
  useSendExecution,
  useSendValidation,
  useSendWarnings,
  type SendReceipt,
} from "@/lib/send/useSend";
import { type ChainId } from "@/lib/swap/assets";
import { colors, radius, spacing, type } from "@/lib/theme";
import type { TokenBalance } from "@/lib/types";

// Send.
//
// The safety rules live in lib/send/useSend.ts, not here, so that changing how
// this screen LOOKS cannot change what it is allowed to DO — the same split the
// swap screen uses, and pinned by lib/__tests__/sendSafety.test.ts. This file is
// the presentation layer: it renders state and forwards intent.
//
// The one rule enforced here as well as there is the confirm gate. The swipe is
// disabled unless every check passes, and the reason is always shown on the
// control itself — a disabled button with no explanation is the single most
// common way a payment screen wastes a user's time.

export default function Send() {
  const params = useLocalSearchParams<{ to?: string }>();
  const router = useRouter();

  const { balances } = useSendBalances();
  const { recents, remember } = useRecipients();
  const clipboard = useClipboardPaste();

  const [destination, setDestination] = useState(params.to ?? "");
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState<TokenBalance | null>(null);
  const [mfaCode, setMfaCode] = useState("");
  const [picking, setPicking] = useState(false);
  const [pickingContact, setPickingContact] = useState(false);

  const selected = source ?? balances[0] ?? null;

  /**
   * The saved contact that owns the address in the field, if any.
   *
   * Looked up against the ADDRESS AND THE CHAIN together — the same key the
   * server uses. A contact matched on the address alone would name someone for
   * a network they never gave an address on, which is a false confirmation on
   * the one screen where a false confirmation costs money.
   */
  const knownContact = useContactForAddress(destination, selected?.chain);

  /**
   * An ENS or FurlPay name typed into the To field.
   *
   * Idle whenever the field already holds an address, so the ordinary path —
   * paste, scan, pick a contact — never touches the resolver. The result is
   * rendered under the field and applied only when the user taps it; a resolver
   * that silently rewrites the payee is the same failure mode as an address
   * substitution, which is what the rest of this screen exists to prevent.
   */
  const resolution = useNameResolution(destination, selected?.chain);

  /**
   * While a name is in play, the field's own "that isn't an EVM address" error
   * is both true and useless — the user knows it isn't an address, they typed a
   * name. Showing it alongside the resolution card puts two contradictory
   * verdicts on screen at once, so the resolution card owns the explanation
   * until it reaches a state that has nothing to say (`idle`).
   *
   * The confirm gate is untouched: `validation.canSend` still requires a
   * genuine address, so suppressing the MESSAGE cannot let a name be sent.
   */
  const resolvingName = resolution.kind !== "idle";

  /**
   * Address handed over by the scanner.
   *
   * `useState(params.to)` alone is not enough: scan.tsx uses router.replace back
   * onto this already-mounted tab, so the initialiser never re-runs and the
   * scanned address silently failed to appear. Applied once per distinct value
   * so it cannot fight the user's own edits.
   */
  const appliedParam = useRef<string | null>(null);
  useEffect(() => {
    const to = params.to;
    if (!to || appliedParam.current === to) return;
    appliedParam.current = to;
    setDestination(to);
  }, [params.to]);

  const validation = useSendValidation(destination, amount, selected);
  const warnings = useSendWarnings({
    amountUsd: validation.amountUsd,
    destination,
    balance: selected,
    addressValid: validation.addressValid,
    recents,
    contactName: knownContact?.name,
  });

  const onSent = useCallback(
    (receipt: SendReceipt) => {
      // Only a transfer the server accepted becomes history. A queued one has
      // not happened yet, and the recents list is what the look-alike check
      // compares against — seeding it with unconfirmed addresses would weaken
      // exactly the protection it exists to provide.
      if (receipt.kind !== "sent") return;
      remember({
        address: receipt.destination,
        chain: receipt.chain as TokenBalance["chain"],
        token: receipt.token,
      });
    },
    [remember]
  );

  const exec = useSendExecution(
    { destination, amount, balance: selected, mfaCode },
    onSent
  );

  /**
   * Percentage shortcuts derive from the BALANCE's USD value — the field is
   * dollar-denominated, so a fraction of the token amount would be the wrong
   * number for anything that is not exactly $1. Truncated to 6dp so the result
   * is always a value parseUsdcAmount accepts, and Max uses the exact spendable
   * value: rounding it up would produce an amount the user cannot send.
   */
  const applyPercent = useCallback(
    (fraction: number) => {
      if (!selected || selected.usdValue <= 0) return;
      const raw = fraction >= 1 ? selected.usdValue : selected.usdValue * fraction;
      const truncated = Math.floor(raw * 1e6) / 1e6;
      setAmount(truncated > 0 ? String(truncated) : "0");
    },
    [selected]
  );

  const reset = useCallback(() => {
    exec.dismiss();
    setDestination("");
    setAmount("");
    setMfaCode("");
    appliedParam.current = null;
  }, [exec]);

  const secondaryText = useMemo(() => {
    if (!selected || validation.tokenEquivalent === undefined) return undefined;
    return `≈ ${validation.tokenEquivalent.toLocaleString(undefined, { maximumFractionDigits: 6 })} ${selected.token}`;
  }, [selected, validation.tokenEquivalent]);

  // ── receipt ──────────────────────────────────────────────────────────────
  if (exec.receipt) {
    const done = exec.receipt;
    const sent = done.kind === "sent";
    return (
      <Screen>
        <ScrollView contentContainerStyle={styles.receipt}>
          <View style={[styles.tick, !sent && { backgroundColor: colors.surfaceRaised }]}>
            <Ionicons
              name={sent ? "checkmark" : "cloud-offline-outline"}
              size={40}
              color={sent ? colors.onNeon : colors.warning}
            />
          </View>
          <Text style={type.h2}>{sent ? "Payment sent" : "Queued — you're offline"}</Text>
          <Text style={[type.dim, { textAlign: "center" }]}>
            {sent
              ? `${usd(done.amountUsd)} ${done.token} to ${shortAddress(done.destination)} on ${chainName(done.chain)}`
              : "This transfer will send automatically when you're back online. Nothing has left your account yet."}
          </Text>

          {sent ? (
            <View style={{ alignSelf: "stretch", marginTop: spacing.md }}>
              <ProgressTimeline
                stage="settled"
                steps={sendSteps(done.chain, done.transactionHash)}
              />
            </View>
          ) : null}

          <Button title="Done" onPress={reset} style={{ alignSelf: "stretch" }} />
        </ScrollView>
      </Screen>
    );
  }

  // ── in-flight ────────────────────────────────────────────────────────────
  //
  // The heading is derived from the AUTHORITATIVE transaction state, not from
  // the UI stage. The three cases are genuinely different answers to "did my
  // money move?", and collapsing them is how a user is told a payment failed
  // when the outcome is actually unknown:
  //
  //   FAILED     -> it did not happen. Retry is safe.
  //   PROCESSING -> we do not know yet. Retry is NOT safe.
  //   otherwise  -> still working.
  if (exec.executing || exec.stage === "failed" || exec.txState === "PROCESSING") {
    const unresolved = exec.txState === "PROCESSING";
    const failed = exec.txState === "FAILED";
    return (
      <Screen>
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={type.h2}>
            {failed
              ? "Payment didn't go through"
              : unresolved
                ? "Still processing"
                : "Sending"}
          </Text>
          {/* A send cannot be in flight without a source, so the timeline is
              rendered from the real chain or not at all — never from a
              stand-in that would name the wrong network on a receipt. */}
          {selected ? (
            <ProgressTimeline
              stage={exec.stage}
              steps={sendSteps(selected.chain as ChainId)}
              // Reaching this screen means the biometric prompt was passed and
              // the request was sent — so it is the submission that failed, not
              // the authorization.
              failedAt={1}
            />
          ) : null}
          {exec.error ? <ErrorNote message={exec.error} /> : null}
          {exec.correlationId ? (
            <Text style={styles.correlation}>Reference {exec.correlationId}</Text>
          ) : null}
          {/* RETRY IS GATED ON THE STATE MACHINE, not on the screen's own idea
              of failure. canUserRetry() is true only from FAILED — offering it
              while the outcome is unknown invites a second payment for one
              intent, which is the exact duplicate this whole spine prevents. */}
          {canUserRetry(exec.txState) ? (
            <Button title="Try again" onPress={() => void exec.execute()} />
          ) : null}
          {isTerminalState(exec.txState) || failed ? (
            <Button
              title="Back"
              variant={canUserRetry(exec.txState) ? "secondary" : "primary"}
              onPress={exec.dismiss}
            />
          ) : null}
        </ScrollView>
      </Screen>
    );
  }

  // ── composer ─────────────────────────────────────────────────────────────
  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {/* Always tappable — including with no balances, which is precisely
            when a user taps it to find out why. The picker explains the empty
            state and offers a way out of it; a dead control explains nothing. */}
        <ValuePanel
          caption="YOU SEND"
          asset={selected ? assetForToken(selected.token) : undefined}
          chain={selected?.chain as ChainId | undefined}
          onPress={() => setPicking(true)}
        >
          <AmountInput
            value={amount}
            onChangeText={setAmount}
            prefix="$"
            balance={selected?.usdValue}
            balanceText={selected ? `Balance ${usd(selected.usdValue)}` : undefined}
            secondaryText={secondaryText}
            error={
              validation.amountError ??
              (validation.insufficientBalance ? validation.blockedReason : null)
            }
            maxLength={AMOUNT_MAX_LENGTH}
            onPercent={applyPercent}
            accessibilityLabel="Amount to send, in US dollars"
          />
        </ValuePanel>

        {/* Straddles the seam between the two panels, exactly where the swap
            screen's flip control sits — so the direction of the movement is
            readable from layout alone. Send has only one direction, so this is
            an indicator, not a control. */}
        <View style={styles.seam} pointerEvents="none">
          <View style={styles.seamDot}>
            <Ionicons name="arrow-down" size={20} color={colors.neon} />
          </View>
        </View>

        <RecipientInput
          value={destination}
          onChangeText={(v) => {
            clipboard.clearNotice();
            setDestination(v);
          }}
          chain={selected?.chain as ChainId | undefined}
          error={resolvingName ? null : validation.addressError}
          valid={validation.addressValid}
          pasteNotice={clipboard.notice}
          onPaste={() => {
            void clipboard.paste().then((address) => {
              if (address) setDestination(address);
            });
          }}
          onScan={() => router.push("/scan")}
          recents={recents}
          onPickRecent={(r) => {
            clipboard.clearNotice();
            setDestination(r.address);
          }}
          onPickContact={() => setPickingContact(true)}
          contactName={knownContact?.name}
          onSaveContact={() =>
            router.push({
              pathname: "/contacts/new",
              // The address only — never the chain. AddressEntryForm re-derives
              // the network from the string itself, so a wrong chain cannot be
              // carried into the address book by a query parameter.
              params: { address: destination.trim() },
            })
          }
        />

        <NameResolution
          state={resolution}
          chain={selected?.chain as ChainId | undefined}
          onUse={(address) => {
            clipboard.clearNotice();
            setDestination(address);
            // Accepting a resolved address is an explicit choice and must
            // survive the scanner's param effect, exactly as picking a contact
            // does — otherwise returning from /scan re-applies an older `?to=`.
            appliedParam.current = address;
          }}
        />

        {exec.unavailable ? (
          <View style={styles.notice} accessibilityRole="alert">
            <Ionicons name="construct-outline" size={16} color={colors.warning} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.noticeTitle}>Sending not enabled here</Text>
              <Text style={type.dim}>{exec.unavailable}</Text>
            </View>
          </View>
        ) : null}

        <WarningList warnings={warnings} />

        {exec.needsMfa ? (
          <Field
            label="Authenticator code"
            value={mfaCode}
            onChangeText={setMfaCode}
            placeholder="123456"
            keyboardType="number-pad"
            maxLength={8}
            autoCapitalize="none"
            autoCorrect={false}
          />
        ) : null}

        {validation.canSend && selected ? (
          <SendSummary
            facts={{
              amountUsd: validation.amountUsd,
              token: selected.token,
              chain: selected.chain as ChainId,
              destination: destination.trim(),
              tokenEquivalent: validation.tokenEquivalent,
              balanceUsd: selected.usdValue,
              ...(knownContact ? { contactName: knownContact.name } : {}),
            }}
          />
        ) : null}

        <ErrorNote message={exec.error} />

        <SwipeToConfirm
          noun="payment"
          label={
            validation.canSend
              ? `Swipe to send ${usd(validation.amountUsd)}`
              : "Swipe to send"
          }
          confirmingLabel="Sending…"
          disabled={!validation.canSend}
          disabledReason={validation.blockedReason ?? undefined}
          onConfirm={() => void exec.execute()}
        />
      </ScrollView>

      <SourceSelector
        visible={picking}
        balances={balances}
        selected={selected}
        onClose={() => setPicking(false)}
        onSelect={setSource}
      />

      <ContactPickerSheet
        open={pickingContact}
        chain={selected?.chain as ChainId | undefined}
        onClose={() => setPickingContact(false)}
        onPick={(pick) => {
          clipboard.clearNotice();
          setDestination(pick.address);
          // A contact chosen here is an explicit act, so it must survive the
          // scanner's param effect: without this, returning from /scan would
          // re-apply an older `?to=` and silently replace the payee the user
          // just picked.
          appliedParam.current = pick.address;
        }}
        onManage={() =>
          router.push({
            pathname: "/contacts",
            // Opens the book already filtered to the network being paid, which
            // is the question the user has at this moment: who can receive
            // this, here?
            ...(selected ? { params: { chain: selected.chain } } : {}),
          })
        }
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xl },
  receipt: {
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  tick: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: colors.neon,
    alignItems: "center",
    justifyContent: "center",
  },
  seam: { alignItems: "center", marginVertical: -18, zIndex: 2 },
  seamDot: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceRaised,
    borderWidth: 3,
    borderColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
  },
  notice: {
    flexDirection: "row",
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.warning + "55",
  },
  noticeTitle: { color: colors.warning, fontSize: 13, fontWeight: "700" },
  correlation: {
    color: colors.textFaint,
    fontSize: 11,
    fontFamily: "monospace",
    textAlign: "center",
  },
});
