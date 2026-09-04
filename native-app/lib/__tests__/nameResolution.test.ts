import { looksResolvable } from "../contacts/useResolveName";

// ---------------------------------------------------------------------------
// Name resolution — the parts that are pure.
//
// `looksResolvable` decides whether the app asks a remote resolver about what
// somebody typed, so it is the difference between one request when a name is
// entered and a request per keystroke for every address ever pasted.
//
// The state machine it feeds is tested through the send screen; what matters
// here is the gate, and one property above all: something that IS an address
// must never be sent to a name resolver, because the answer is already in hand.
// ---------------------------------------------------------------------------

const EVM = "0x1111111111111111111111111111111111111111";
const SOL = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";

describe("looksResolvable", () => {
  it("never asks a resolver about something that is already an address", () => {
    expect(looksResolvable(EVM)).toBe(false);
    expect(looksResolvable(SOL)).toBe(false);
    // Casing is a checksum on EVM, not an identity — an upper-case address is
    // still an address.
    expect(looksResolvable(EVM.toUpperCase().replace("0X", "0x"))).toBe(false);
  });

  it("treats a half-typed 0x string as a mistyped address, not a name", () => {
    // Otherwise every character of a pasted-then-edited address is a lookup for
    // a name that cannot exist.
    expect(looksResolvable("0x12")).toBe(false);
    expect(looksResolvable("0xdeadbeef")).toBe(false);
  });

  it("accepts names", () => {
    expect(looksResolvable("vitalik.eth")).toBe(true);
    expect(looksResolvable("alice")).toBe(true);
    expect(looksResolvable("furlpay.sol")).toBe(true);
  });

  it("ignores keystrokes on the way to a name", () => {
    expect(looksResolvable("")).toBe(false);
    expect(looksResolvable("a")).toBe(false);
    expect(looksResolvable("vi")).toBe(false);
  });

  it("refuses input longer than the server accepts", () => {
    // The route rejects anything over 255 characters; sending it is a
    // guaranteed 400 and a wasted round trip.
    expect(looksResolvable("x".repeat(255))).toBe(true);
    expect(looksResolvable("x".repeat(256))).toBe(false);
  });

  it("tolerates surrounding whitespace, because pasted text has it", () => {
    expect(looksResolvable("  vitalik.eth  ")).toBe(true);
    expect(looksResolvable(`  ${EVM}  `)).toBe(false);
  });

  it("does not try to predict which name schemes exist", () => {
    // The server supports ENS and FurlPay handles today and will add more. A
    // client-side pattern guessing the list is a client that silently stops
    // resolving the day a new kind ships, so anything name-shaped is passed on
    // and the server decides.
    expect(looksResolvable("someone.crypto")).toBe(true);
    expect(looksResolvable("bob.base.eth")).toBe(true);
    expect(looksResolvable("a-brand-new-scheme")).toBe(true);
  });
});
