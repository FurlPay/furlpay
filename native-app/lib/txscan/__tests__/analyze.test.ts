import { analyzeTransaction, SELECTORS, UINT256_MAX, short } from "../analyze";
import { worstRisk } from "../types";

// The always-on scanning layer. Its job is to be correct offline, so every
// test here is pure — no network, no provider, no chain state.

const ME = "0x1111111111111111111111111111111111111111";
const SPENDER = "0x2222222222222222222222222222222222222222";
const TOKEN = "0x3333333333333333333333333333333333333333";
const ZERO = "0x0000000000000000000000000000000000000000";

function word(value: bigint): string {
  return value.toString(16).padStart(64, "0");
}
function addrWord(a: string): string {
  return a.slice(2).toLowerCase().padStart(64, "0");
}

function base(over: Partial<Parameters<typeof analyzeTransaction>[0]> = {}) {
  return { chainId: 1, from: ME, to: TOKEN, value: 0n, data: "0x", ...over };
}

describe("native transfers", () => {
  it("records the outgoing amount", () => {
    const r = analyzeTransaction(base({ to: SPENDER, value: 10n ** 18n }));
    expect(r.category).toBe("native_transfer");
    expect(r.deltas[0].rawAmount).toBe(-(10n ** 18n));
  });

  // Costs gas, changes nothing. Almost always a mistake worth naming.
  it("flags a transaction that does nothing", () => {
    const r = analyzeTransaction(base({ to: SPENDER, value: 0n, data: "0x" }));
    expect(r.findings.some((f) => f.id === "empty_transaction")).toBe(true);
  });
});

describe("ERC-20 approvals", () => {
  it("flags an unlimited approval as danger", () => {
    const data = `${SELECTORS.erc20Approve}${addrWord(SPENDER)}${word(UINT256_MAX)}`;
    const r = analyzeTransaction(base({ data }));
    expect(r.category).toBe("token_approval");
    expect(r.level).toBe("danger");
    expect(r.findings.some((f) => f.id === "unlimited_approval")).toBe(true);
  });

  // Contracts use 2^255-1 and other near-max sentinels interchangeably. An
  // equality check against 2^256-1 lets those through as ordinary amounts —
  // the exact bug the threshold exists to close.
  it("treats near-maximum sentinels as unlimited too", () => {
    for (const sentinel of [(1n << 255n) - 1n, 1n << 200n, (1n << 128n) + 1n]) {
      const data = `${SELECTORS.erc20Approve}${addrWord(SPENDER)}${word(sentinel)}`;
      const r = analyzeTransaction(base({ data }));
      expect(r.findings.some((f) => f.id === "unlimited_approval")).toBe(true);
    }
  });

  it("treats a bounded approval as caution, not danger", () => {
    const data = `${SELECTORS.erc20Approve}${addrWord(SPENDER)}${word(1000n)}`;
    const r = analyzeTransaction(base({ data, verifiedContracts: new Set([TOKEN, SPENDER]) }));
    expect(r.findings.some((f) => f.id === "approval")).toBe(true);
    expect(r.findings.some((f) => f.id === "unlimited_approval")).toBe(false);
    expect(r.level).toBe("caution");
  });

  it("recognises a revocation as safe", () => {
    const data = `${SELECTORS.erc20Approve}${addrWord(SPENDER)}${word(0n)}`;
    const r = analyzeTransaction(base({ data, verifiedContracts: new Set([TOKEN, SPENDER]) }));
    expect(r.findings.some((f) => f.id === "approval_revoke")).toBe(true);
    expect(r.level).toBe("safe");
  });

  it("refuses to guess when the approval cannot be decoded", () => {
    const r = analyzeTransaction(base({ data: `${SELECTORS.erc20Approve}dead` }));
    expect(r.level).toBe("danger");
    expect(r.findings.some((f) => f.id === "approval_unreadable")).toBe(true);
  });

  // An approval should never move the chain's own coin. When it does, something
  // is wrong with what the user was told they are doing.
  it("flags native value attached to an approval", () => {
    const data = `${SELECTORS.erc20Approve}${addrWord(SPENDER)}${word(1000n)}`;
    const r = analyzeTransaction(base({ data, value: 10n ** 17n }));
    expect(r.findings.some((f) => f.id === "value_with_approval")).toBe(true);
    expect(r.level).toBe("danger");
  });

  it("covers Permit2's four-argument approve", () => {
    const data = `${SELECTORS.permit2Approve}${addrWord(TOKEN)}${addrWord(SPENDER)}${word(UINT256_MAX)}${word(0n)}`;
    const r = analyzeTransaction(base({ data }));
    expect(r.findings.some((f) => f.id === "unlimited_approval")).toBe(true);
  });
});

describe("NFT approvals", () => {
  // Always danger: it grants transfer rights over every token in the
  // collection, present and future, with no amount to cap the loss.
  it("treats setApprovalForAll(true) as danger", () => {
    const data = `${SELECTORS.erc721SetApprovalForAll}${addrWord(SPENDER)}${word(1n)}`;
    const r = analyzeTransaction(base({ data }));
    expect(r.category).toBe("nft_approval_all");
    expect(r.level).toBe("danger");
  });

  it("treats setApprovalForAll(false) as a revocation", () => {
    const data = `${SELECTORS.erc721SetApprovalForAll}${addrWord(SPENDER)}${word(0n)}`;
    const r = analyzeTransaction(base({ data, verifiedContracts: new Set([TOKEN]) }));
    expect(r.findings.some((f) => f.id === "nft_approval_revoke")).toBe(true);
    expect(r.level).toBe("safe");
  });
});

describe("transfers", () => {
  it("flags the zero address as an irreversible burn", () => {
    const data = `${SELECTORS.erc20Transfer}${addrWord(ZERO)}${word(1000n)}`;
    const r = analyzeTransaction(base({ data }));
    expect(r.findings.some((f) => f.id === "burn_address")).toBe(true);
    expect(r.level).toBe("danger");
  });

  it("notes a first-time recipient without raising the risk level", () => {
    const data = `${SELECTORS.erc20Transfer}${addrWord(SPENDER)}${word(1000n)}`;
    const r = analyzeTransaction(base({ data, verifiedContracts: new Set([TOKEN]) }));
    expect(r.findings.some((f) => f.id === "new_recipient")).toBe(true);
    // A screen where every ordinary transfer warns is a screen nobody reads.
    expect(r.level).toBe("safe");
  });

  it("stays quiet about a recipient already in the address book", () => {
    const data = `${SELECTORS.erc20Transfer}${addrWord(SPENDER)}${word(1000n)}`;
    const r = analyzeTransaction(
      base({ data, knownAddresses: { [SPENDER.toLowerCase()]: "Alice" }, verifiedContracts: new Set([TOKEN]) }),
    );
    expect(r.findings.some((f) => f.id === "new_recipient")).toBe(false);
  });

  it("decodes an ERC-721 transfer", () => {
    const data = `${SELECTORS.erc721SafeTransferFrom}${addrWord(ME)}${addrWord(SPENDER)}${word(42n)}`;
    const r = analyzeTransaction(base({ data }));
    expect(r.category).toBe("nft_transfer");
    expect(r.deltas[0].tokenId).toBe("42");
    expect(r.deltas[0].kind).toBe("erc721");
  });
});

describe("unrecognised calls", () => {
  // The single most important default in the module: not knowing is never safe.
  it("reports unknown rather than safe", () => {
    const r = analyzeTransaction(base({ data: "0xdeadbeef" }));
    expect(r.category).toBe("contract_call");
    expect(r.level).not.toBe("safe");
    expect(r.findings.some((f) => f.id === "unrecognised_call")).toBe(true);
  });
});

describe("address word validation", () => {
  // A non-zero high half means a different type is being misread as an address.
  // Rendering it would show a plausible but wrong counterparty.
  it("refuses an address word with a dirty high half", () => {
    const dirty = `${"f".repeat(24)}${SPENDER.slice(2)}`;
    const data = `${SELECTORS.erc20Approve}${dirty}${word(1000n)}`;
    const r = analyzeTransaction(base({ data }));
    expect(r.findings.some((f) => f.id === "approval_unreadable")).toBe(true);
  });
});

describe("worstRisk", () => {
  it("returns the most severe level present", () => {
    expect(worstRisk(["safe", "caution", "unknown"])).toBe("caution");
    expect(worstRisk(["safe", "danger", "caution"])).toBe("danger");
    expect(worstRisk(["safe"])).toBe("safe");
    expect(worstRisk([])).toBe("safe");
  });
});

describe("short", () => {
  // Head AND tail: a prefix alone is exactly what lookalike-address attacks are
  // generated to match.
  it("keeps both ends of the address", () => {
    expect(short(SPENDER)).toBe("0x2222…2222");
    expect(short("0xabc")).toBe("0xabc");
  });
});
