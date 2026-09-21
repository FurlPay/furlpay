import { z } from "zod";

// ---------------------------------------------------------------------------
// Request-body schemas for the WebAuthn ceremony endpoints.
//
// WHY THESE ARE DELIBERATELY LOOSE IN THE MIDDLE
// ==============================================
// The real authority on a WebAuthn response is @simplewebauthn/server, which
// verifies the signature, the challenge, the origin and the RP ID. A Zod
// schema cannot add security to that and MUST NOT get in its way: over-
// constraining `response` would reject valid assertions from authenticators
// that legitimately include extra fields, and would have to be revised every
// time the spec grows one.
//
// So these schemas do the job Zod is actually good for, which the routes were
// not doing at all (`const body = await req.json()`):
//
//   - route the body through validateBody, which enforces the 100KB cap
//     BEFORE JSON.parse runs, so an oversized payload cannot burn the
//     function's memory;
//   - reject anything that is not a credential-shaped object at the edge with
//     a 400, instead of letting it reach the verifier and surface as a 500;
//   - bound the strings, so a multi-megabyte `id` never reaches the store.
//
// `.passthrough()` on the inner object is the point: unknown authenticator
// fields are preserved and handed to the verifier untouched.
// ---------------------------------------------------------------------------

/** Base64url, as every WebAuthn identifier is transported. */
const b64url = z
  .string()
  .min(1)
  .max(2048)
  .regex(/^[A-Za-z0-9_-]+$/, "Expected base64url");

/**
 * The common envelope of a PublicKeyCredential as serialised by the browser's
 * `.toJSON()` (or SimpleWebAuthn's browser helper).
 */
const CredentialEnvelope = z
  .object({
    id: b64url,
    // Required, not optional: every real PublicKeyCredential JSON carries
    // both, and @simplewebauthn's types declare them non-optional. Marking
    // them optional here made the parsed type unassignable to
    // RegistrationResponseJSON / AuthenticationResponseJSON -- the typechecker
    // caught it, which is the schema earning its keep.
    rawId: b64url,
    type: z.literal("public-key"),
    // Verified in full by @simplewebauthn/server; only its presence, rough
    // size and the fields this route reads are our business. `transports` is
    // declared because the register route stores it -- under a bare
    // passthrough it arrives as `unknown`.
    // Required, not optional and not defaulted. The browser always sends it
    // and @simplewebauthn declares it non-optional.
    //
    // `.default({})` looks tidier but breaks the call site: it makes the
    // schema's INPUT type differ from its OUTPUT type, and
    // `validateBody<T>(req, schema: ZodSchema<T>)` unifies T with the input --
    // so the parsed value came back with `clientExtensionResults` still
    // optional and would not typecheck against the verifier's argument.
    clientExtensionResults: z.object({}).passthrough(),
    authenticatorAttachment: z.enum(["platform", "cross-platform"]).optional(),
  })
  .passthrough();

/**
 * The transports WebAuthn defines. An enum, not `string[]`: the value is
 * stored against the credential and fed back into `allowCredentials`, so an
 * arbitrary string there would be persisted junk.
 */
const AuthenticatorTransport = z.enum([
  "ble",
  "cable",
  "hybrid",
  "internal",
  "nfc",
  "smart-card",
  "usb",
]);

/** Base64url payload carried inside `response`. Generous, but bounded. */
const b64urlBlob = z.string().min(1).max(64 * 1024).regex(/^[A-Za-z0-9_-]+$/, "Expected base64url");

/**
 * POST /api/auth/passkey/register — an attestation response.
 *
 * `clientDataJSON` and `attestationObject` are required by the spec and by
 * @simplewebauthn's RegistrationResponseJSON, so requiring them here rejects a
 * malformed body with a 400 at the edge rather than a 500 out of the verifier.
 */
export const PasskeyRegistrationSchema = CredentialEnvelope.extend({
  response: z
    .object({
      clientDataJSON: b64urlBlob,
      attestationObject: b64urlBlob,
      // Stored against the credential, so it needs a concrete type -- under a
      // bare passthrough it arrives as `unknown`.
      transports: z.array(AuthenticatorTransport).max(16).optional(),
    })
    .passthrough(),
});

/** POST /api/auth/passkey/authenticate — an assertion response. */
export const PasskeyAuthenticationSchema = CredentialEnvelope.extend({
  response: z
    .object({
      clientDataJSON: b64urlBlob,
      authenticatorData: b64urlBlob,
      signature: b64urlBlob,
      // Present for discoverable credentials (usernameless sign-in).
      userHandle: z.string().max(2048).optional(),
    })
    .passthrough(),
});

export type PasskeyRegistrationBody = z.infer<typeof PasskeyRegistrationSchema>;
export type PasskeyAuthenticationBody = z.infer<typeof PasskeyAuthenticationSchema>;
