import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-8 text-center">
      <div className="text-6xl font-extrabold tracking-tighter text-accent">404</div>
      <p className="mt-3 text-textSecondary">This page doesn&apos;t exist.</p>
      <Link href="/dashboard" className="mt-6 rounded-pill bg-accent px-6 py-3 font-semibold">
        Back to dashboard
      </Link>
    </div>
  );
}
