"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { sendJSON } from "@/lib/api";

// ---------------------------------------------------------------------------
// "Sign in with Apple" via AppleID.auth (Apple JS). When
// NEXT_PUBLIC_APPLE_CLIENT_ID is set we load Apple's JS SDK and run the real
// popup flow; the returned identity token (JWT) is posted to /api/auth/apple
// for server-side verification. With no client id (mock/dev) we render a stub
// button that posts an unsigned dev token so the flow is fully testable
// offline. Mirrors GoogleSignInButton.
// Docs: https://developer.apple.com/documentation/sign_in_with_apple/sign_in_with_apple_js
// ---------------------------------------------------------------------------

const CLIENT_ID = process.env.NEXT_PUBLIC_APPLE_CLIENT_ID;
const REDIRECT = process.env.NEXT_PUBLIC_APPLE_REDIRECT_URI;

interface AppleResult {
  success: boolean;
  email: string;
  name: string;
  phoneVerified: boolean;
}

declare global {
  interface Window {
    AppleID?: any;
  }
}

export default function AppleSignInButton({
  onSuccess,
  onError,
}: {
  onSuccess: (r: AppleResult) => void;
  onError?: (msg: string) => void;
}) {
  const [ready, setReady] = useState(false);
  const initialized = useRef(false);

  async function submit(idToken: string, name?: string) {
    try {
      const r = await sendJSON<AppleResult>("/api/auth/apple", { id_token: idToken, name });
      if (r.success) onSuccess(r);
      else onError?.("Apple sign-in failed.");
    } catch {
      onError?.("Apple sign-in failed.");
    }
  }

  useEffect(() => {
    if (!ready || !CLIENT_ID || !window.AppleID || initialized.current) return;
    window.AppleID.auth.init({
      clientId: CLIENT_ID,
      scope: "name email",
      redirectURI: REDIRECT || (typeof window !== "undefined" ? window.location.origin : ""),
      usePopup: true,
    });
    initialized.current = true;
  }, [ready]);

  async function realAppleSignIn() {
    try {
      const resp = await window.AppleID.auth.signIn();
      const idToken = resp?.authorization?.id_token;
      const name = resp?.user?.name ? `${resp.user.name.firstName ?? ""} ${resp.user.name.lastName ?? ""}`.trim() : undefined;
      if (idToken) submit(idToken, name || undefined);
      else onError?.("Apple sign-in returned no token.");
    } catch {
      onError?.("Apple sign-in was cancelled.");
    }
  }

  // Dev fallback: build an unsigned token the mock verifier accepts.
  function devAppleSignIn() {
    const b64 = (o: unknown) =>
      btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const payload = {
      sub: "apple-dev-001973.abc",
      email: "ashutosh@privaterelay.appleid.com",
      email_verified: true,
    };
    const token = `${b64({ alg: "none", typ: "JWT" })}.${b64(payload)}.stub`;
    submit(token, "Ashutosh");
  }

  const Button = (
    <button
      onClick={CLIENT_ID ? realAppleSignIn : devAppleSignIn}
      className="flex w-full max-w-xs items-center justify-center gap-2 rounded-pill bg-white py-3.5 font-semibold text-black"
    >
      <AppleGlyph /> Continue with Apple
    </button>
  );

  if (!CLIENT_ID) return Button;

  return (
    <>
      <Script
        src="https://appleid.cdn-apple.com/appleauth/static/jsapi/appleid/1/en_US/appleid.auth.js"
        onReady={() => setReady(true)}
      />
      {Button}
    </>
  );
}

function AppleGlyph() {
  return (
    <svg width="16" height="18" viewBox="0 0 384 512" aria-hidden fill="currentColor">
      <path d="M318.7 268.7c-.2-36.7 16.4-64.4 50-84.8-18.8-26.9-47.2-41.7-84.7-44.6-35.5-2.8-74.3 20.7-88.5 20.7-15 0-49.4-19.7-76.4-19.7C63.3 141.2 4 184.8 4 273.5q0 39.3 14.4 81.2c12.8 36.7 59 126.7 107.2 125.2 25.2-.6 43-17.9 75.8-17.9 31.8 0 48.3 17.9 76.4 17.9 48.6-.7 90.4-82.5 102.6-119.3-65.2-30.7-61.7-90-61.7-91.9zm-56.6-164.2c27.3-32.4 24.8-61.9 24-72.5-24.1 1.4-52 16.4-67.9 34.9-17.5 19.8-27.8 44.3-25.6 71.9 26.1 2 49.9-11.4 69.5-34.3z" />
    </svg>
  );
}
