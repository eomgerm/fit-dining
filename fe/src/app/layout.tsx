import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { InstallBanner } from "@/domains/install/ui/install-banner";
import "./globals.css";
import { Providers } from "./providers";
import { RegisterServiceWorker } from "./register-sw";

// ponytail: 가변 폰트 전체(2MB)를 한 번에 받는다. 첫 로딩이 문제되면 Pretendard dynamic subset으로 바꾼다
const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  // 생략하면 WebKit에서 굵기가 틀리게 그려진다(Pretendard README)
  weight: "45 920",
  variable: "--font-pretendard",
});

export const metadata: Metadata = {
  title: "핏다이닝",
  description: "오늘 끌리는 곳, 내 취향으로 찾기",
  // iOS는 매니페스트 아이콘 대신 apple-touch-icon(PNG)을 읽는다
  icons: { apple: "/icons/apple-touch-icon.png" },
  // 홈 화면 앱에서 영상·지도·사진을 상태바 아래까지 깐다. 콘텐츠가 화면 전체에 그려지고 상태바가 위를 덮는다(Apple Supported Meta Tags).
  // 가려지면 안 되는 요소는 globals.css의 pt-safe-*·top-safe-*로 내린다
  appleWebApp: {
    capable: true,
    title: "핏다이닝",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  // 브라우저 상단바를 페이지 바탕(--color-surface)과 같은 흰색으로 맞춘다
  themeColor: "#ffffff",
  // 자동 여백을 끄고 화면 전체에 그린다. 시스템 영역은 env(safe-area-inset-*)로 피한다
  viewportFit: "cover",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ko" className={`${pretendard.variable} h-full antialiased`}>
      {/* Base UI 권장 설정: relative는 iOS Safari에서 backdrop이 화면을 덮게 하고,
          isolate는 body에 붙는 팝업(portal)이 페이지 z-index에 가리지 않게 한다 */}
      <body className="relative flex min-h-full flex-col">
        <div className="isolate flex flex-1 flex-col">
          <Providers>{children}</Providers>
        </div>
        {/* 페이지 뒤에 두어 z-index 없이 페이지 위에 뜨고, 나중에 body에 붙는 다이얼로그 딤에는 덮인다 */}
        <InstallBanner />
        <RegisterServiceWorker />
      </body>
    </html>
  );
}
