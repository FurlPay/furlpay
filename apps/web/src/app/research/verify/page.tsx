import type { Metadata } from "next";
import VerifyDownload from "./VerifyDownload";

// The landing page for an emailed verification link. It must never be
// indexed, and it carries no token server-side: the token is in the URL
// fragment, read and posted by the client component.
export const metadata: Metadata = {
  title: "Confirm your download — FurlPay Research",
  robots: { index: false, follow: false },
};

export default function Page() {
  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col justify-center px-4 py-16">
      <p className="text-[12px] font-semibold uppercase tracking-[0.14em] text-neon">FurlPay Research</p>
      <VerifyDownload />
    </main>
  );
}
