import { securityLevel, levelPresentation } from "../security";

// The security level MUST be derived from genuine signals, not hardcoded.

describe("securityLevel", () => {
  it("is STRONG only with verified email + passkey + biometric", () => {
    expect(securityLevel({ emailVerified: true, passkey: true, biometric: true })).toBe("strong");
  });

  it("is MEDIUM with verified email + one strong protection", () => {
    expect(securityLevel({ emailVerified: true, passkey: true, biometric: false })).toBe("medium");
    expect(securityLevel({ emailVerified: true, passkey: false, biometric: true })).toBe("medium");
  });

  it("is WEAK with verified email but no passkey/biometric", () => {
    expect(securityLevel({ emailVerified: true, passkey: false, biometric: false })).toBe("weak");
  });

  it("is WEAK whenever the email is unverified, regardless of other signals", () => {
    expect(securityLevel({ emailVerified: false, passkey: true, biometric: true })).toBe("weak");
    expect(securityLevel({ emailVerified: false, passkey: false, biometric: false })).toBe("weak");
  });
});

describe("levelPresentation", () => {
  it("maps each level to a distinct label + colour", () => {
    const strong = levelPresentation("strong");
    const medium = levelPresentation("medium");
    const weak = levelPresentation("weak");
    expect(strong.label).toBe("Strong");
    expect(medium.label).toBe("Medium");
    expect(weak.label).toBe("Weak");
    expect(new Set([strong.color, medium.color, weak.color]).size).toBe(3);
  });
});
