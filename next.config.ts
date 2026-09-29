import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  experimental: {
    // Import CSV : plusieurs années d'historique tiennent dans quelques Mo
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
