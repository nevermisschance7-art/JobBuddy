import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@jobbuddy/shared"],
  experimental: {
    // CV uploads go through a server action. Netlify functions accept up to ~6 MB.
    serverActions: { bodySizeLimit: "6mb" },
  },
};

export default nextConfig;
