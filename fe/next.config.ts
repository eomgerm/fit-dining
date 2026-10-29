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
