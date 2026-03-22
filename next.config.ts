import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    typedRoutes: true,
  },
  typescript: {
    // Type-checking exceeds Vercel's 8 GB memory limit with typedRoutes.
    // Types are validated locally via `tsc --noEmit`.
    ignoreBuildErrors: true,
  },
};

export default nextConfig;
