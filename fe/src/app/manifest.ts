import type { MetadataRoute } from "next";

// 아이콘은 /icons/ 아래에 둔다. dev 게이트가 쿠키 없이 여는 경로가 /manifest.webmanifest와 /icons/*뿐이다(infra/edge/conf/Caddyfile)
export default function manifest(): MetadataRoute.Manifest {
  return {
    // 설치된 앱의 정체성. start_url이 바뀌어도 같은 앱으로 보게 고정한다
    id: "/",
    name: "핏다이닝",
    short_name: "핏다이닝",
    description: "내 취향에 맞춘 미식 여정",
    start_url: "/",
    display: "standalone",
    theme_color: "#ffffff",
    background_color: "#f2622e",
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
