import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 필요한 의존성과 server.js만 컨테이너에 담는다(design.md 12.5 #1).
  output: "standalone",
  // Arm 빌드를 x86에서도 쓰도록 네이티브 이미지 최적화를 끈다(design.md 12.5 #7).
  images: { unoptimized: true },
  // 배포 간 버전 스큐를 커밋 SHA로 감지한다(design.md 12.5 #1).
  deploymentId: process.env.DEPLOYMENT_VERSION || undefined,
  // 배포 빌드는 커밋 SHA, 로컬 빌드는 Next 기본 ID를 쓴다(design.md 12.5 #1).
  generateBuildId: async () => process.env.DEPLOYMENT_VERSION || null,
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
