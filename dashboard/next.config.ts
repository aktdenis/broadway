import type { NextConfig } from "next";

const PR_HOST = "pr-(?<pr>\\d+)\\.broadway\\.akash\\.world";

const nextConfig: NextConfig = {
  output: "standalone",
  async rewrites() {
    return [
      // Root path of a preview subdomain
      {
        source: "/",
        has: [{ type: "host", value: PR_HOST }],
        destination: "/api/preview-proxy/:pr",
      },
      // All sub-paths of a preview subdomain
      {
        source: "/:path+",
        has: [{ type: "host", value: PR_HOST }],
        destination: "/api/preview-proxy/:pr/:path*",
      },
    ];
  },
};

export default nextConfig;
