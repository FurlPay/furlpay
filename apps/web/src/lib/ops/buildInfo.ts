// ---------------------------------------------------------------------------
// Deployment provenance — answers "what exact commit is running in production?".
//
// Sourced from platform env vars (Vercel-provided git metadata, or the
// FURLPAY_BUILD_SHA a manual CLI deploy injects via --build-env). Every field
// falls back to "unknown"; a missing var never throws. Contains NO secrets — a
// commit SHA, branch, build id and environment are all safe to show an ops admin.
//
// Lives in lib/ (not the route) because a Next.js route file may only export
// handlers; a helper exported from route.ts fails the App Router type check.
// ---------------------------------------------------------------------------

export interface BuildInfo {
  commitSha: string;
  commitShaShort: string;
  branch: string;
  buildId: string;
  environment: string;
  deployedAt: string;
}

export function buildInfo(): BuildInfo {
  const commitSha =
    process.env.VERCEL_GIT_COMMIT_SHA ?? process.env.FURLPAY_BUILD_SHA ?? "unknown";
  return {
    commitSha,
    commitShaShort: commitSha === "unknown" ? "unknown" : commitSha.slice(0, 7),
    branch: process.env.VERCEL_GIT_COMMIT_REF ?? process.env.FURLPAY_BUILD_BRANCH ?? "unknown",
    buildId: process.env.VERCEL_DEPLOYMENT_ID ?? process.env.FURLPAY_BUILD_ID ?? "unknown",
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "unknown",
    // Only when the build stamped a time; never fabricated.
    deployedAt: process.env.FURLPAY_BUILD_TIME ?? "unknown",
  };
}
