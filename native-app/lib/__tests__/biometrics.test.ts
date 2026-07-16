// Regression for B3: Settings → Security → "Biometric approvals" used to be
// decorative — every screen called LocalAuthentication directly, so toggling
// it changed nothing. confirmWithBiometrics is now the single gate and must
// honor the cached profile preference, defaulting to ON (fail-secure) when the
// profile isn't loaded.

jest.mock("expo-local-authentication", () => ({
  hasHardwareAsync: jest.fn(async () => true),
  isEnrolledAsync: jest.fn(async () => true),
  authenticateAsync: jest.fn(async () => ({ success: true })),
}));

import * as LocalAuthentication from "expo-local-authentication";
import { confirmWithBiometrics, biometricApprovalsEnabled } from "../biometrics";
import { queryClient } from "../queries";

const mockAuth = LocalAuthentication.authenticateAsync as jest.Mock;
const mockEnrolled = LocalAuthentication.isEnrolledAsync as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  queryClient.clear();
  mockEnrolled.mockResolvedValue(true);
  mockAuth.mockResolvedValue({ success: true });
});

describe("confirmWithBiometrics — honors the profile preference (B3)", () => {
  it("prompts when the profile has biometricEnabled: true", async () => {
    queryClient.setQueryData(["profile"], { security: { biometricEnabled: true } });
    await expect(confirmWithBiometrics("Send $5")).resolves.toBe(true);
    expect(mockAuth).toHaveBeenCalledWith({ promptMessage: "Send $5" });
  });

  it("SKIPS the prompt when the user turned Biometric approvals off", async () => {
    queryClient.setQueryData(["profile"], { security: { biometricEnabled: false } });
    await expect(confirmWithBiometrics("Send $5")).resolves.toBe(true);
    expect(mockAuth).not.toHaveBeenCalled();
  });

  it("fail-secure: prompts when no profile is cached (unknown ≠ opted out)", async () => {
    expect(biometricApprovalsEnabled()).toBe(true);
    await confirmWithBiometrics("Send $5");
    expect(mockAuth).toHaveBeenCalled();
  });

  it("propagates a failed/dismissed prompt as false", async () => {
    mockAuth.mockResolvedValue({ success: false });
    await expect(confirmWithBiometrics("Send $5")).resolves.toBe(false);
  });

  it("passes through without a prompt when no biometrics are enrolled", async () => {
    mockEnrolled.mockResolvedValue(false);
    await expect(confirmWithBiometrics("Send $5")).resolves.toBe(true);
    expect(mockAuth).not.toHaveBeenCalled();
  });
});
