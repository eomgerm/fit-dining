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
  // 운영에서는 Caddy가 /api와 사진 업로드 경로를 BE와 Garage로 보낸다. 로컬 `next dev`에서만 직접 프록시한다(design.md 12.5 #2).
  // 사진 업로드는 presigned URL이라 Garage가 받는 Host가 BE의 S3_PUBLIC_ENDPOINT와 같아야 한다(리뷰 D-45).
  // 사진 읽기(/photos/dev/confirmed/)는 Host를 바꿔야 해서 app/photos 라우트 핸들러가 맡는다
  // 서비스 워커는 매번 새로 받고 같은 출처 스크립트만 쓴다(Next PWA 가이드). 그 밖의 public/ 캐시 헤더는 Next 기본값을 쓴다
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Cache-Control",
            value: "no-cache, no-store, must-revalidate",
          },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'",
          },
        ],
      },
      // 에이전트는 그대로 읽되, 밖에서 링크되어도 원문 파일이 검색 결과에 뜨지 않게 한다
      {
        source: "/llms.txt",
        headers: [{ key: "X-Robots-Tag", value: "noindex" }],
      },
    ];
  },
  async rewrites() {
    if (process.env.NODE_ENV !== "development") return [];
    const backend = process.env.BE_INTERNAL_URL ?? "http://localhost:8080";
    const photos = process.env.LOCAL_PHOTO_S3_URL ?? "http://127.0.0.1:13900";
    return [
      { source: "/api/:path*", destination: `${backend}/api/:path*` },
      {
        source: "/fit-dev-photos/:path*",
        destination: `${photos}/fit-dev-photos/:path*`,
      },
    ];
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
