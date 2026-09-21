/**
 * Non-provider marks for the sign-in screen.
 *
 * Google's and Apple's logos live in GoogleSignInButton.tsx and
 * AppleSignInButton.tsx, next to the flows they belong to, because both
 * vendors tie the mark to the button as a unit. These are the marks that
 * belong to nobody.
 *
 * They exist because the passkey and phone buttons shipped with no icon at
 * all -- the passkey button's label even carried a stray leading space where
 * one had been stripped, which rendered as a visible indent.
 */

/**
 * Biometric / passkey mark.
 *
 * NOT the FIDO Alliance passkey icon. FIDO publishes an official one and
 * recommends it for passkey sign-in, but it is released only after accepting
 * a usage agreement at https://fidoalliance.org/passkey-download/, so it
 * cannot be vendored here until someone accepts it. Drawing an imitation of a
 * mark whose whole purpose is to be recognisable would be worse than using
 * none, so this is a plain fingerprint with no trademark attached.
 *
 * Swap it for the real asset once the agreement is signed: only this function
 * and its native twin change.
 */
export function BiometricMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 4.5c-2.3 0-4.3 1.1-5.6 2.8" />
      <path d="M18 8.2A6.9 6.9 0 0 0 12 4.5" />
      <path d="M5.2 10.4A7 7 0 0 0 5 12v2.2c0 1.2-.3 2.4-.8 3.4" />
      <path d="M19 12v2.6c0 1.5.3 3 .9 4.4" />
      <path d="M8.5 12a3.5 3.5 0 0 1 7 0v3.5c0 1.3.2 2.6.6 3.8" />
      <path d="M12 12v4.2c0 1.1.1 2.2.4 3.3" />
      <path d="M15.5 19.8A12 12 0 0 1 15 16" />
    </svg>
  );
}

/** Phone handset, for the SMS one-time-code route. */
export function PhoneMark({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <rect x="6.5" y="2.5" width="11" height="19" rx="2.5" />
      <path d="M10.75 5.5h2.5" />
      <path d="M11 18.5h2" />
    </svg>
  );
}
