"use client";

import { useEffect, useState } from "react";

// Minimal shape of the Persona v4 web SDK we rely on.
interface PersonaClientOptions {
  templateId: string;
  referenceId: string;
  environment: "sandbox" | "production";
  onComplete: (args: { inquiryId: string }) => void;
  onCancel: () => void;
  onError: (error: unknown) => void;
}
declare global {
  interface Window {
    Persona?: { Client: new (opts: PersonaClientOptions) => { open: () => void } };
  }
}

const PERSONA_SRC = "https://cdn.withpersona.com/dist/persona-v4.js";

// Launches Persona's embedded Inquiry flow (Selfie + Government ID) in-domain.
// The script is loaded once and cached across mounts (never removed on unmount,
// which was a bug in the reference snippet).
export default function PersonaKycButton({
  userId,
  disabled,
  onSuccess,
  onCancel,
}: {
  userId: string;
  disabled?: boolean;
  onSuccess: (inquiryId: string) => void;
  onCancel?: () => void;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (window.Persona) {
      setReady(true);
      return;
    }
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${PERSONA_SRC}"]`);
    if (existing) {
      existing.addEventListener("load", () => setReady(true));
      return;
    }
    const script = document.createElement("script");
    script.src = PERSONA_SRC;
    script.async = true;
    script.onload = () => setReady(true);
    document.body.appendChild(script);
  }, []);

  const start = () => {
    const templateId = process.env.NEXT_PUBLIC_PERSONA_TEMPLATE_ID;
    if (!window.Persona || !templateId) {
      console.error("Persona SDK not loaded or template id missing.");
      return;
    }
    const client = new window.Persona.Client({
      templateId,
      referenceId: userId, // maps the Furlpay user id to the Persona inquiry
      environment: (process.env.NEXT_PUBLIC_PERSONA_ENV as "sandbox" | "production") || "sandbox",
      onComplete: ({ inquiryId }) => onSuccess(inquiryId),
      onCancel: () => onCancel?.(),
      onError: (error) => console.error("Persona error:", error),
    });
    client.open();
  };

  return (
    <button
      type="button"
      onClick={start}
      disabled={disabled || !ready}
      className="w-full rounded-pill bg-neon py-3.5 font-semibold text-black shadow-glow transition-transform hover:-translate-y-0.5 disabled:opacity-50"
    >
      {ready ? "Verify Identity with Biometrics" : "Loading verification…"}
    </button>
  );
}
