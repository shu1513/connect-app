import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page in this step depends on who is logged in and what time it is,
  // so nothing may be served from a cache. The framework's page caching
  // (cacheComponents / partialPrefetching) stays off until there are public
  // pages that benefit from it, such as host profiles.
  // While developing, let the app be opened through a temporary secure tunnel
  // (needed for phones, and so LiveKit can reach this computer).
  allowedDevOrigins: ["*.trycloudflare.com"],
  // While developing, the framework prints the address of every request. The address TikTok sends a
  // host back to holds a one-time code, which does not belong in a log.
  logging: { incomingRequests: { ignore: [/\/api\/social\/tiktok\/return/] } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
