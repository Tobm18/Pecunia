import type { NextConfig } from "next";
import pkg from "./package.json";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Version et copyright affichés dans l'app, lus depuis package.json au build
  env: {
    NEXT_PUBLIC_APP_VERSION: pkg.version,
    NEXT_PUBLIC_APP_AUTHOR: pkg.author,
    NEXT_PUBLIC_APP_COMMIT: (process.env.VERCEL_GIT_COMMIT_SHA ?? "").slice(0, 7),
  },
  // le service worker doit être revérifié à chaque visite pour que les mises à jour arrivent
  async headers() {
    return [{ source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }] }];
  },
  experimental: {
    // Import CSV : plusieurs années d'historique tiennent dans quelques Mo
    serverActions: { bodySizeLimit: "10mb" },
  },
};

export default nextConfig;
