import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Every page in this step depends on who is logged in and what time it is,
  // so nothing may be served from a cache. The framework's page caching
  // (cacheComponents / partialPrefetching) stays off until there are public
  // pages that benefit from it, such as host profiles.
  // While developing, let the app be opened through a temporary secure tunnel
  // (needed for phones, and so LiveKit can reach this computer).
  allowedDevOrigins: ["*.trycloudflare.com"],
  // While developing, the framework prints the address of every request. The address TikTok or Meta
  // sends a host back to holds a one-time code, which does not belong in a log.
  logging: { incomingRequests: { ignore: [/\/api\/social\/tiktok\/return/, /\/api\/social\/instagram\/return/] } },
  // The framework has an address of its own (/_next/image) that fetches a picture of the site, makes a smaller
  // copy and keeps that copy for hours. The app uses it for nothing, and a diary picture must never be kept
  // anywhere that does not ask again who may see it (plans/24, "Showing a picture"). So no path of the app is
  // allowed to it. (The framework still lets its own built-in media files through; a picture's address is not among them.)
  images: { localPatterns: [] },
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
