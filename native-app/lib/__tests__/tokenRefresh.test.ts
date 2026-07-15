import { tokenExpiryMs } from "../api";

// The refresh scheduler only needs exp out of the JWT — unverified (the server
// re-verifies everything), but it must never throw and never misread.

function fakeJwt(payload: object): string {
  const b64url = (s: string) =>
    Buffer.from(s).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${b64url('{"alg":"HS256"}')}.${b64url(JSON.stringify(payload))}.sig`;
}

describe("tokenExpiryMs", () => {
  it("reads exp (seconds) and returns milliseconds", () => {
    expect(tokenExpiryMs(fakeJwt({ sub: "u1", exp: 1_800_000_000 }))).toBe(1_800_000_000_000);
  });

  it("handles base64url payloads containing - and _ characters", () => {
    // A sub crafted so the encoded payload contains both url-safe chars.
    const token = fakeJwt({ sub: "??>>??>>", exp: 2_000_000_000 });
    expect(token.split(".")[1]).toMatch(/[-_]/); // the test premise holds
    expect(tokenExpiryMs(token)).toBe(2_000_000_000_000);
  });

  it("returns null instead of throwing on garbage", () => {
    expect(tokenExpiryMs("not-a-jwt")).toBeNull();
    expect(tokenExpiryMs("a.b.c")).toBeNull();
    expect(tokenExpiryMs("")).toBeNull();
    expect(tokenExpiryMs(fakeJwt({ sub: "u1" }))).toBeNull(); // no exp claim
    expect(tokenExpiryMs(fakeJwt({ exp: "soon" }))).toBeNull(); // exp not a number
  });
});
