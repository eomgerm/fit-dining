import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  reactCompiler: true,
  // 운영에서는 Caddy가 /api를 BE로 보낸다. 로컬 `next dev`에서만 직접 프록시한다(design.md 12.5 #2)
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    const backend = process.env.BE_INTERNAL_URL ?? "http://localhost:8080";
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
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
