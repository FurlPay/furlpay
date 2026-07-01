"use client";

import { useEffect, useRef, useState } from "react";
import Script from "next/script";
import { sendJSON } from "@/lib/api";

// ---------------------------------------------------------------------------
// "Sign in with Google" via Google Identity Services. When
// NEXT_PUBLIC_GOOGLE_CLIENT_ID is set we load the real GIS client and render
// Google's official button; the callback posts the returned ID token (JWT) to
// /api/auth/google for server-side verification. With no client id (mock/dev),
// we render a stub button that posts an unsigned dev token so the flow is fully
// testable offline. Docs: https://developers.google.com/identity/gsi/web
// ---------------------------------------------------------------------------

const CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

interface GoogleResult {
  success: boolean;
  email: string;
  name: string;
  phoneVerified: boolean;
}

declare global {
  interface Window {
    google?: any;
  }
}

export default function GoogleSignInButton({
  onSuccess,
  onError,
}: {
  onSuccess: (r: GoogleResult) => void;
  onError?: (msg: string) => void;
}) {
  const divRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  async function submitCredential(credential: string) {
    try {
      const r = await sendJSON<GoogleResult>("/api/auth/google", { credential });
      if (r.success) onSuccess(r);
      else onError?.("Google sign-in failed.");
    } catch {
      onError?.("Google sign-in failed.");
    }
  }

  // Render the real GIS button once the script is ready and a client id exists.
  useEffect(() => {
    if (!ready || !CLIENT_ID || !window.google || !divRef.current) return;
    window.google.accounts.id.initialize({
      client_id: CLIENT_ID,
      callback: (resp: { credential: string }) => submitCredential(resp.credential),
    });
    window.google.accounts.id.renderButton(divRef.current, {
      theme: "filled_black",
      size: "large",
      shape: "pill",
      text: "continue_with",
      width: 320,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  // Dev fallback: build an unsigned token the mock verifier accepts.
  function devGoogleSignIn() {
    const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    const payload = {
      sub: "google-dev-1088675309",
      email: "ashutosh@gmail.com",
      email_verified: true,
      name: "Ashutosh",
    };
    const token = `${b64({ alg: "none", typ: "JWT" })}.${b64(payload)}.stub`;
    submitCredential(token);
  }

  if (!CLIENT_ID) {
    return (
      <button
        onClick={devGoogleSignIn}
        className="flex w-full max-w-xs items-center justify-center gap-2 rounded-pill bg-white py-3.5 font-semibold text-black"
      >
        <GoogleGlyph /> Continue with Google
      </button>
    );
  }

  return (
    <>
      <Script src="https://accounts.google.com/gsi/client" onReady={() => setReady(true)} />
      <div ref={divRef} className="flex justify-center" />
    </>
  );
}

function GoogleGlyph() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
    </svg>
  );
}
