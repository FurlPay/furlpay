// Multi-wallet discovery announcement — makes FurlPay discoverable by dapps.
//
// EIP-6963 (eips.ethereum.org/EIPS/eip-6963): wallets announce an EIP-1193
// provider via `eip6963:announceProvider` window events instead of fighting
// over window.ethereum; dapps enumerate every installed wallet conflict-free.
// CAIP-294 (standards.chainagnostic.org/CAIPs/caip-294): the chain-agnostic
// equivalent, announced alongside so non-EVM-aware clients also discover us.
//
// This runs in the MAIN world (page-accessible by definition) so it holds no
// secrets and no session state. The provider supports discovery, connection
// and chain selection; signing intentionally stays on furlpay.com where the
// user's passkey lives (a chrome-extension:// origin can't perform WebAuthn
// for the furlpay.com rpID — same rationale as the 3DS2 approval flow).

interface Eip1193RequestArgs {
  method: string;
  params?: unknown[] | Record<string, unknown>;
}

const BRIDGE_REQUEST = "furlpay-wallet";
const BRIDGE_RESULT = "furlpay-wallet-result";
const CONNECT_TIMEOUT_MS = 60_000;

// Supported chains (hex chain ids) — mirrors @furlpay/types CHAINS.
const CHAIN_IDS: Record<string, string> = {
  ethereum: "0x1",
  polygon: "0x89",
  base: "0x2105",
  arbitrum: "0xa4b1",
  gnosis: "0x64",
  robinhood: "0x1237", // Robinhood Chain, 4663
  bsc: "0x38",
};
const DEFAULT_CHAIN = CHAIN_IDS.arbitrum;

// 96x96 mark, data URI as EIP-6963 requires (no remote fetch at render time).
const ICON =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" rx="22" fill="#FF3B30"/><text x="48" y="63" font-family="Arial,Helvetica,sans-serif" font-size="48" font-weight="700" fill="#fff" text-anchor="middle">F</text></svg>'
  );

export default defineContentScript({
  matches: ["<all_urls>"],
  world: "MAIN",
  runAt: "document_start",
  main() {
    type Listener = (payload: unknown) => void;
    const listeners = new Map<string, Set<Listener>>();
    const pending = new Map<
      string,
      { resolve: (accounts: string[]) => void; reject: (e: unknown) => void }
    >();

    let accounts: string[] = [];
    let chainId = DEFAULT_CHAIN;

    function emit(event: string, payload: unknown) {
      listeners.get(event)?.forEach((fn) => {
        try {
          fn(payload);
        } catch {
          /* listener errors must not break the page */
        }
      });
    }

    function rpcError(code: number, message: string) {
      return Object.assign(new Error(message), { code });
    }

    // Results come back from the isolated-world bridge via postMessage.
    window.addEventListener("message", (event) => {
      if (event.source !== window) return;
      const msg = event.data as {
        source?: string;
        id?: string;
        ok?: boolean;
        data?: { accounts?: string[] };
        error?: string;
      };
      if (msg?.source !== BRIDGE_RESULT || typeof msg.id !== "string") return;
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.ok && Array.isArray(msg.data?.accounts)) p.resolve(msg.data.accounts);
      else p.reject(rpcError(4001, msg.error || "Connection request was rejected."));
    });

    function requestConnect(): Promise<string[]> {
      const id = crypto.randomUUID();
      return new Promise<string[]>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        window.postMessage({ source: BRIDGE_REQUEST, id, method: "connect" }, "*");
        setTimeout(() => {
          if (pending.delete(id)) reject(rpcError(4001, "Connection request timed out."));
        }, CONNECT_TIMEOUT_MS);
      });
    }

    const provider = {
      isFurlPay: true as const,

      async request(args: Eip1193RequestArgs): Promise<unknown> {
        if (!args || typeof args.method !== "string") {
          throw rpcError(-32600, "Invalid request.");
        }
        switch (args.method) {
          case "eth_chainId":
            return chainId;
          case "eth_accounts":
            return accounts;
          case "eth_requestAccounts": {
            if (accounts.length) return accounts;
            const next = await requestConnect();
            accounts = next;
            emit("accountsChanged", accounts);
            emit("connect", { chainId });
            return accounts;
          }
          case "wallet_switchEthereumChain": {
            const target = (args.params as [{ chainId?: string }] | undefined)?.[0]?.chainId;
            const known = Object.values(CHAIN_IDS).includes(String(target));
            if (!known) {
              throw rpcError(4902, `Chain ${target} is not supported by FurlPay.`);
            }
            if (chainId !== target) {
              chainId = String(target);
              emit("chainChanged", chainId);
            }
            return null;
          }
          default:
            // Signing happens on furlpay.com (passkey-bound origin), never here.
            throw rpcError(
              4200,
              `FurlPay does not support ${args.method} from the page context — ` +
                "transactions are signed with your passkey on furlpay.com."
            );
        }
      },

      on(event: string, fn: Listener) {
        if (!listeners.has(event)) listeners.set(event, new Set());
        listeners.get(event)!.add(fn);
        return provider;
      },
      removeListener(event: string, fn: Listener) {
        listeners.get(event)?.delete(fn);
        return provider;
      },
    };

    // --- EIP-6963 -----------------------------------------------------------
    const info = Object.freeze({
      uuid: crypto.randomUUID(),
      name: "FurlPay",
      icon: ICON,
      rdns: "com.furlpay.app",
    });

    function announceEip6963() {
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", {
          detail: Object.freeze({ info, provider }),
        })
      );
    }
    window.addEventListener("eip6963:requestProvider", announceEip6963);
    announceEip6963();

    // --- CAIP-294 (chain-agnostic discovery) ---------------------------------
    function announceCaip294() {
      window.dispatchEvent(
        new CustomEvent("caip294:wallet_announce", {
          detail: Object.freeze({
            id: crypto.randomUUID(),
            jsonrpc: "2.0" as const,
            method: "wallet_announce" as const,
            params: Object.freeze({
              uuid: info.uuid,
              name: info.name,
              icon: info.icon,
              rdns: info.rdns,
            }),
          }),
        })
      );
    }
    window.addEventListener("caip294:wallet_prompt", announceCaip294);
    announceCaip294();
  },
});
