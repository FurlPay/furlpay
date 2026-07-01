"use client";

import { AlertIcon } from "@/components/icons";

// Global error boundary for the App Router.
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-8 text-center">
      <AlertIcon className="mb-2 h-10 w-10 text-loss" />
      <h1 className="text-xl font-bold">Something went wrong</h1>
      <p className="mt-2 max-w-xs text-[13px] text-textSecondary">{error.message || "An unexpected error occurred."}</p>
      <button onClick={reset} className="mt-6 rounded-pill bg-accent px-6 py-3 font-semibold">
        Try again
      </button>
    </div>
  );
}
