"use client";

import { useCallback, useEffect, useState } from "react";

// Circle user-controlled (MPC) wallets — the browser half.
//
// The server (/api/wallets/circle*) holds the Circle API key and the policy;
// this component only runs challenges. Circle's Web SDK opens its own iframe
// (https://pw-auth.circle.com — allowed in next.config.js frame-src) where the
// user sets or enters their PIN; FurlPay never sees the PIN or a key share.
//
// The SDK's completion callback is treated as a hint, not a result: after it
// fires, the challenge status is read back from Circle through
// /api/wallets/circle/challenge, and only that status is shown.
//
// The SDK is imported dynamically so its dependencies (it bundles firebase for
// Circle's social login) load on this page only, when a challenge runs.

interface Balance {
  tokenId: string | null;
  amount: string;
  symbol: string | null;
  blockchain: string | null;
}
interface Wallet {
  id: string;
  address: string;
  blockchain: string;
  state: string;
  accountType: string | null;
  balances: Balance[];
}
interface Session {
  appId: string;
  userToken: string;
  encryptionKey: string;
  challengeId: string;
}
type Load =
  | { kind: "loading" }
  | { kind: "signed_out" }
  | { kind: "unavailable" }
  | { kind: "error"; message: string }
  | { kind: "ready"; wallets: Wallet[]; chains: string[]; environment: string | null };

const TERMINAL = new Set(["COMPLETE", "FAILED", "EXPIRED"]);

async function readError(res: Response): Promise<string> {
  try {
    const j = await res.json();
    return typeof j.error === "string" ? j.error : `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

/** Open Circle's challenge UI, then confirm the outcome with Circle via our API. */
async function runChallenge(session: Session, onStatus: (s: string) => void): Promise<string> {
  const { W3SSdk } = await import("@circle-fin/w3s-pw-web-sdk");
  const sdk = new W3SSdk({ appSettings: { appId: session.appId } });
  sdk.setAuthentication({ userToken: session.userToken, encryptionKey: session.encryptionKey });

  onStatus("Waiting for you to confirm in Circle's window…");
  const sdkError = await new Promise<string | null>((resolve) => {
    sdk.execute(session.challengeId, (error) => resolve(error ? `${error.code ?? ""} ${error.message}`.trim() : null));
  });
  if (sdkError) onStatus(`Circle reported: ${sdkError}. Checking the challenge status…`);
  else onStatus("Confirming with Circle…");

  for (let i = 0; i < 15; i++) {
    const res = await fetch(`/api/wallets/circle/challenge?id=${encodeURIComponent(session.challengeId)}`, { cache: "no-store" });
    if (res.ok) {
      const { challenge } = await res.json();
      if (TERMINAL.has(challenge.status)) return challenge.status as string;
    } else if (res.status !== 502) {
      throw new Error(await readError(res));
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  return "PENDING";
}

export default function CircleWalletPanel() {
  const [load, setLoad] = useState<Load>({ kind: "loading" });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [chain, setChain] = useState("");

  const refresh = useCallback(async () => {
    const res = await fetch("/api/wallets/circle", { cache: "no-store" });
    if (res.status === 401) return setLoad({ kind: "signed_out" });
    if (res.status === 503) return setLoad({ kind: "unavailable" });
    if (!res.ok) return setLoad({ kind: "error", message: await readError(res) });
    const body = await res.json();
    setLoad({ kind: "ready", wallets: body.wallets, chains: body.chains, environment: body.environment });
    setChain((c) => c || body.chains[0] || "");
  }, []);

  useEffect(() => {
    refresh().catch((e) => setLoad({ kind: "error", message: (e as Error).message }));
  }, [refresh]);

  const challenge = useCallback(
    async (start: () => Promise<Response>, done: string) => {
      setBusy(true);
      setStatus(null);
      try {
        const res = await start();
        if (!res.ok) throw new Error(await readError(res));
        const outcome = await runChallenge((await res.json()) as Session, setStatus);
        setStatus(
          outcome === "COMPLETE"
            ? done
            : outcome === "PENDING"
              ? "Circle has not finished this yet. Refresh in a minute to see the result."
              : `Circle reports the challenge ${outcome.toLowerCase()}. Nothing was changed.`
        );
        await refresh();
      } catch (e) {
        setStatus((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [refresh]
  );

  if (load.kind === "loading") return <Shell><p className="text-sm text-white/50">Loading…</p></Shell>;
  if (load.kind === "signed_out")
    return (
      <Shell>
        <p className="text-sm text-white/70">
          <a className="underline" href="/login?next=/circle-wallet">Sign in</a> to manage your Circle wallet.
        </p>
      </Shell>
    );
  if (load.kind === "unavailable")
    return <Shell><p className="text-sm text-white/70">Circle wallets are not enabled on this deployment.</p></Shell>;
  if (load.kind === "error") return <Shell><p role="alert" className="text-sm text-red-400">{load.message}</p></Shell>;

  return (
    <Shell environment={load.environment}>
      {load.wallets.length === 0 ? (
        <section className="rounded-2xl border border-white/10 p-5">
          <h2 className="text-base font-semibold">Create your wallet</h2>
          <p className="mt-1 text-sm text-white/60">
            You will set a PIN in Circle&apos;s secure window. FurlPay never sees it, and cannot move funds without it.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <label className="text-sm text-white/70" htmlFor="circle-chain">Network</label>
            <select
              id="circle-chain"
              className="rounded-lg border border-white/15 bg-transparent px-3 py-2 text-sm"
              value={chain}
              onChange={(e) => setChain(e.target.value)}
              disabled={busy}
            >
              {load.chains.map((c) => (
                <option key={c} value={c} className="bg-neutral-900">{c}</option>
              ))}
            </select>
            <button
              type="button"
              className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
              disabled={busy || !chain}
              onClick={() =>
                challenge(
                  () =>
                    fetch("/api/wallets/circle", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({ blockchains: [chain] }),
                    }),
                  "Your wallet is ready."
                )
              }
            >
              Create wallet
            </button>
          </div>
        </section>
      ) : (
        <ul className="space-y-4">
          {load.wallets.map((w) => (
            <WalletCard key={w.id} wallet={w} busy={busy} onTransfer={challenge} />
          ))}
        </ul>
      )}
      {status && (
        <p role="status" className="mt-4 text-sm text-white/70">
          {status}
        </p>
      )}
    </Shell>
  );
}

function WalletCard({
  wallet,
  busy,
  onTransfer,
}: {
  wallet: Wallet;
  busy: boolean;
  onTransfer: (start: () => Promise<Response>, done: string) => Promise<void>;
}) {
  const [destination, setDestination] = useState("");
  const [amount, setAmount] = useState("");
  // One key per intended transfer: a retry of the same form re-sends it, so
  // Circle returns the existing challenge instead of creating a second one.
  const [idempotencyKey, setIdempotencyKey] = useState(() => crypto.randomUUID());
  const usdc = wallet.balances.find((b) => b.symbol === "USDC");

  return (
    <li className="rounded-2xl border border-white/10 p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold">{wallet.blockchain}</span>
        <span className="text-xs text-white/50">{wallet.state}{wallet.accountType ? ` · ${wallet.accountType}` : ""}</span>
      </div>
      <p className="mt-1 break-all font-mono text-xs text-white/70">{wallet.address}</p>
      <dl className="mt-3 space-y-1 text-sm">
        {wallet.balances.length === 0 ? (
          <div className="text-white/50">No token balances.</div>
        ) : (
          wallet.balances.map((b, i) => (
            <div key={b.tokenId ?? i} className="flex justify-between">
              <dt className="text-white/60">{b.symbol ?? "Unknown token"}</dt>
              <dd className="tabular-nums">{b.amount}</dd>
            </div>
          ))
        )}
      </dl>

      {usdc && wallet.state === "LIVE" && (
        <form
          className="mt-4 grid gap-2 sm:grid-cols-[1fr_8rem_auto]"
          onSubmit={(e) => {
            e.preventDefault();
            void onTransfer(
              () =>
                fetch("/api/wallets/circle/transfer", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ idempotencyKey, walletId: wallet.id, destinationAddress: destination.trim(), amount: amount.trim() }),
                }),
              "Transfer approved. Circle is submitting it to the network."
            ).then(() => {
              setIdempotencyKey(crypto.randomUUID());
            });
          }}
        >
          <input
            aria-label="Destination address"
            placeholder="Destination address"
            className="rounded-lg border border-white/15 bg-transparent px-3 py-2 font-mono text-xs"
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            disabled={busy}
            required
          />
          <input
            aria-label="Amount in USDC"
            placeholder="USDC"
            inputMode="decimal"
            className="rounded-lg border border-white/15 bg-transparent px-3 py-2 text-sm tabular-nums"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            disabled={busy}
            required
          />
          <button
            type="submit"
            className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-black disabled:opacity-50"
            disabled={busy || !destination || !amount}
          >
            Send USDC
          </button>
        </form>
      )}
    </li>
  );
}

function Shell({ children, environment }: { children: React.ReactNode; environment?: string | null }) {
  return (
    <div className="mx-auto max-w-2xl px-5 pt-6 pb-16">
      <h1 className="text-2xl font-semibold">Circle wallet</h1>
      <p className="mt-1 text-sm text-white/60">
        A self-custodied MPC wallet secured by your PIN, operated by Circle.
        {environment === "testnet" && <span className="ml-1 text-amber-300">Testnet — tokens have no value.</span>}
      </p>
      <div className="mt-6">{children}</div>
    </div>
  );
}
