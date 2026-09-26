import { readFileSync } from "fs";
import { join } from "path";

// ---------------------------------------------------------------------------
// The Opaque Payment Card must reach Google as BYTES, not as text.
//
// An OPC is an encrypted, signed binary container (OpenPGP) that the server
// hands over base64-encoded. `PushTokenizeRequest.setOpaquePaymentCard` wants
// the DECODED bytes. Passing the base64 string's own UTF-8 bytes produces a
// well-formed request carrying garbage, and Google answers with a generic
// tokenization failure that points at the wallet rather than at the encoding.
//
// The Kotlin cannot be exercised from Jest, so these assertions are on the
// source. That is worth stating plainly: they prove the call SHAPE is right,
// not that provisioning works. Provisioning needs a real issuer, a real device,
// and a real Google Wallet — see app/cards/[id].tsx.
// ---------------------------------------------------------------------------

const module_ = readFileSync(
  join(
    __dirname,
    "..",
    "..",
    "modules",
    "google-pay-provisioning",
    "android",
    "src",
    "main",
    "java",
    "expo",
    "modules",
    "googlepay",
    "GooglePayProvisioningModule.kt"
  ),
  "utf8"
);

/** Kotlin with comments stripped, so "not present" means "not used". */
const code = module_
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/^\s*\/\/.*$/gm, "")
  .replace(/\s\/\/.*$/gm, "");

describe("the OPC is decoded before it is handed to Google", () => {
  it("decodes base64 rather than re-encoding the string", () => {
    expect(code).toContain("Base64.decode(opcBase64, Base64.DEFAULT)");
  });

  it("never passes the base64 text's own bytes", () => {
    // `opcBase64.toByteArray()` is the bug this replaced.
    expect(code).not.toContain("opcBase64.toByteArray()");
  });

  it("uses the standard alphabet, not the URL-safe one", () => {
    // An OPC uses +/ rather than -_. URL_SAFE would mis-decode those two
    // characters wherever they appear, corrupting the container silently.
    expect(code).not.toContain("Base64.URL_SAFE");
  });

  it("imports android.util.Base64", () => {
    expect(code).toContain("import android.util.Base64");
  });

  it("rejects an undecodable or empty payload instead of proceeding", () => {
    // Base64.decode throws IllegalArgumentException on malformed input. An
    // uncaught throw here crosses the JNI boundary as an opaque native crash.
    expect(code).toContain("IllegalArgumentException");
    expect(code).toContain("INVALID_OPC");
    expect(code).toMatch(/opcBytes\.isEmpty\(\)/);
  });
});

describe("the wallet info reports a real hardware id", () => {
  it("reads the stable hardware id from the SDK", () => {
    // Visa — the network Rain issues on — requires the stable hardware id when
    // generating the OPC, and binds the OPC to whatever it is given.
    expect(code).toContain("stableHardwareId");
  });

  it('no longer returns the literal "UNKNOWN"', () => {
    // A placeholder here mints an OPC bound to a device that does not exist.
    expect(code).not.toContain('"UNKNOWN"');
  });

  it("fails rather than substituting a placeholder when the id is unavailable", () => {
    expect(code).toContain("HARDWARE_ID_ERROR");
  });
});
