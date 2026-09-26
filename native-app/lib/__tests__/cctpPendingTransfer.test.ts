import {
  PENDING_TTL_MS,
  clearPendingTransfer,
  loadPendingTransfer,
  resumeStageFor,
  savePendingTransfer,
  updatePendingTransfer,
  type PendingCctpTransfer,
} from "../cctp/pendingTransfer";

jest.mock("expo-secure-store", () => {
  const store = new Map<string, string>();
  return {
    __store: store,
    AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY: "afu-tdo",
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: "wu-tdo",
    setItemAsync: jest.fn(async (k: string, v: string) => void store.set(k, v)),
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    deleteItemAsync: jest.fn(async (k: string) => void store.delete(k)),
  };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const secureStore = require("expo-secure-store") as {
  __store: Map<string, string>;
  setItemAsync: jest.Mock;
  getItemAsync: jest.Mock;
  deleteItemAsync: jest.Mock;
};

function record(over: Partial<PendingCctpTransfer> = {}): PendingCctpTransfer {
  return {
    burnTxHash: "0x" + "a".repeat(64),
    sourceChain: "arbitrum",
    destinationChain: "base",
    sourceDomain: 3,
    amountAtomic: "100000000",
    recipient: "0x" + "b".repeat(40),
    attestationPath: "/api/intents/cctp/attestation?sourceDomain=3&txHash=",
    startedAt: Date.now(),
    ...over,
  };
}

beforeEach(() => {
  secureStore.__store.clear();
  jest.clearAllMocks();
});

describe("a burn that outlives the app is still claimable", () => {
  it("round-trips the record", async () => {
    const t = record();
    await savePendingTransfer(t);
    expect(await loadPendingTransfer()).toEqual(t);
  });

  it("stores under a ThisDeviceOnly accessibility policy", async () => {
    // The record can be read before first unlock on a cold start, but must
    // never be eligible to leave the device in a backup.
    await savePendingTransfer(record());
    const opts = secureStore.setItemAsync.mock.calls[0][2];
    expect(opts.keychainAccessible).toBe("afu-tdo");
    expect(String(opts.keychainAccessible)).toContain("tdo");
    expect(opts.requireAuthentication).toBeUndefined();
  });

  it("resumes at the attestation wait when only the burn has landed", () => {
    expect(resumeStageFor(record())).toBe("await_attestation");
  });

  it("resumes at the mint when the attestation was already fetched", () => {
    expect(resumeStageFor(record({ message: "0xm", attestation: "0xa" }))).toBe("ready_to_mint");
  });

  it("discards a record whose burn was never broadcast", () => {
    // Written before sending on purpose; if the send never happened there is
    // nothing on-chain to resume and the record is noise.
    expect(resumeStageFor(record({ burnTxHash: undefined }))).toBe("discard");
  });
});

describe("the record never breaks the transfer it is tracking", () => {
  it("swallows a write failure rather than throwing into the burn path", async () => {
    secureStore.setItemAsync.mockRejectedValueOnce(new Error("keychain locked"));
    await expect(savePendingTransfer(record())).resolves.toBeUndefined();
  });

  it("returns null rather than throwing on unreadable storage", async () => {
    secureStore.getItemAsync.mockRejectedValueOnce(new Error("keychain locked"));
    expect(await loadPendingTransfer()).toBeNull();
  });

  it("returns null on corrupt JSON instead of crashing the resume path", async () => {
    secureStore.__store.set("cctp_pending_transfer", "{not json");
    expect(await loadPendingTransfer()).toBeNull();
  });

  it("rejects a structurally wrong record", async () => {
    secureStore.__store.set("cctp_pending_transfer", JSON.stringify({ hello: "world" }));
    expect(await loadPendingTransfer()).toBeNull();
  });
});

describe("expiry", () => {
  it("drops a record past the TTL and clears it", async () => {
    await savePendingTransfer(record({ startedAt: Date.now() - PENDING_TTL_MS - 1 }));
    expect(await loadPendingTransfer()).toBeNull();
    expect(secureStore.deleteItemAsync).toHaveBeenCalled();
  });

  it("keeps a day-old record, because an unminted burn is still claimable", async () => {
    const day = 24 * 60 * 60 * 1000;
    await savePendingTransfer(record({ startedAt: Date.now() - day }));
    expect(await loadPendingTransfer()).not.toBeNull();
  });
});

describe("updates", () => {
  it("merges the attestation in without losing the burn hash", async () => {
    const t = record();
    await savePendingTransfer(t);
    const next = await updatePendingTransfer({ message: "0xm", attestation: "0xa" });
    expect(next).toMatchObject({ burnTxHash: t.burnTxHash, message: "0xm", attestation: "0xa" });
  });

  it("does nothing when there is no record to update", async () => {
    expect(await updatePendingTransfer({ message: "0xm" })).toBeNull();
  });

  it("clear removes it", async () => {
    await savePendingTransfer(record());
    await clearPendingTransfer();
    expect(await loadPendingTransfer()).toBeNull();
  });
});
