/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Compile the shared TypeScript compliance package from the monorepo.
  transpilePackages: [
    "@furlpay/compliance",
    "@furlpay/types",
    "@furlpay/account-kit",
    "@furlpay/ui",
    "@furlpay/security",
    "@furlpay/ledger",
  ],
};

module.exports = nextConfig;
