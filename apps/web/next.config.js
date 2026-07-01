/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Compile the shared TypeScript compliance package from the monorepo.
  transpilePackages: ["@furlpay/compliance", "@furlpay/types", "@furlpay/account-kit", "@furlpay/ui"],
};

module.exports = nextConfig;
