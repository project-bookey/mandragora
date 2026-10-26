/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  trailingSlash: true,
  experimental: { cpus: 2 },
  webpack(config, { isServer }) {
    if (isServer) config.externals.push({ "node:sqlite": "commonjs node:sqlite" });
    return config;
  },
  eslint: { ignoreDuringBuilds: true },
};
export default nextConfig;
