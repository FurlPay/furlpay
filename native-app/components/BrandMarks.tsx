import Svg, { Path } from "react-native-svg";

/**
 * Identity-provider marks for the sign-in screen.
 *
 * WHY THESE ARE NOT IONICONS
 * ==========================
 * The login screen used `Ionicons name="logo-google"` and
 * `Ionicons name="logo-apple"`. Both are monochrome approximations drawn by a
 * third party, and for Google that is a straight breach of its published
 * terms:
 *
 *   "The button must always include the standard color for the Google 'G'.
 *    Monochrome versions and custom icons are prohibited."
 *   -- https://developers.google.com/identity/branding-guidelines
 *
 * Apple is equally particular: within a Sign in with Apple button both the
 * logo and the title must be black or white, drawn from Apple's own mark, with
 * no custom colours.
 *   -- https://developer.apple.com/design/human-interface-guidelines/sign-in-with-apple
 *
 * These are store-review and trademark issues, not taste. `react-native-svg`
 * is already a dependency, so the real four-colour mark costs nothing to ship.
 *
 * The same paths are used by the web build's GoogleSignInButton and
 * AppleSignInButton, so all three surfaces render an identical mark.
 */

/** Google's four-colour "G". Colours are fixed by Google and must not change. */
export function GoogleG({ size = 18 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48">
      <Path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <Path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <Path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <Path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </Svg>
  );
}

/**
 * Apple's mark. Single colour by requirement -- black on a light button,
 * white on a dark one -- so the caller passes the colour.
 */
export function AppleMark({ size = 18, color = "#000000" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={(size * 18) / 16} viewBox="0 0 384 512">
      <Path
        fill={color}
        d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z"
      />
    </Svg>
  );
}

/**
 * Biometric / passkey mark.
 *
 * NOT the FIDO Alliance passkey icon. FIDO publishes an official one and
 * recommends it for passkey sign-in, but the asset is released only after
 * accepting its usage agreement at
 * https://fidoalliance.org/passkey-download/ -- so it cannot be vendored here
 * without someone signing that first, and drawing an imitation of a mark that
 * exists specifically to be recognisable would defeat its purpose.
 *
 * This is therefore a plain fingerprint glyph with no trademark attached:
 * honest about what it is, and safe to ship. Swap it for the real passkey
 * icon once the agreement is accepted -- only this function changes.
 */
export function BiometricMark({ size = 18, color = "#000000" }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      <Path
        fill="none"
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M12 4.5c-2.3 0-4.3 1.1-5.6 2.8M18 8.2A6.9 6.9 0 0 0 12 4.5M5.2 10.4A7 7 0 0 0 5 12v2.2c0 1.2-.3 2.4-.8 3.4M19 12v2.6c0 1.5.3 3 .9 4.4M8.5 12a3.5 3.5 0 0 1 7 0v3.5c0 1.3.2 2.6.6 3.8M12 12v4.2c0 1.1.1 2.2.4 3.3M15.5 19.8A12 12 0 0 1 15 16"
      />
    </Svg>
  );
}
