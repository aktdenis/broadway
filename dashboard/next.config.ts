import type { NextConfig } from "next";

const PR_HOST = "pr-(?<pr>\\d+)\\.broadway\\.akash\\.world";

const nextConfig: NextConfig = {
  output: "standalone",
  // The Cloudflare worker proxies pr-N.akash.world/ to /api/preview-proxy/N/
  // (trailing slash). Without this, Next 308-redirects to drop the slash and
  // the worker re-prefixes the path, breaking the preview root.
  skipTrailingSlashRedirect: true,
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
