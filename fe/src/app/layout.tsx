import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { InstallBanner } from "@/domains/install/ui/install-banner";
import "./globals.css";
import { Providers } from "./providers";
import { RegisterServiceWorker } from "./register-sw";
import { siteDescription } from "./site";

// ponytail: 가변 폰트 전체(2MB)를 한 번에 받는다. 첫 로딩이 문제되면 Pretendard dynamic subset으로 바꾼다
const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  // 생략하면 WebKit에서 굵기가 틀리게 그려진다(Pretendard README)
  weight: "45 920",
  variable: "--font-pretendard",
});

// dev와 prod가 같은 이미지라 환경변수 대신 prod 주소로 고정한다. dev는 엣지 게이트가 크롤러를 막는다
// canonical은 여기 두지 않는다. 두면 자기 값을 안 정한 모든 페이지가 홈을 가리킨다
export const metadata: Metadata = {
  metadataBase: new URL("https://fitdining.co.kr"),
  title: { default: "핏다이닝", template: "%s | 핏다이닝" },
  description: siteDescription,
  // 공유 이미지(og:image, twitter:image)는 opengraph-image.png 파일 규칙이 붙인다
  openGraph: {
    type: "website",
    siteName: "핏다이닝",
    locale: "ko_KR",
    title: "핏다이닝",
    description: siteDescription,
  },
  twitter: { card: "summary_large_image" },
  // iOS는 매니페스트 아이콘 대신 apple-touch-icon(PNG)을 읽는다
  icons: { apple: "/icons/apple-touch-icon.png" },
  // statusBarStyle은 두지 않는다. black-translucent는 deprecated이고 홈 화면 앱은 상태바 아래에 그리지 못한다(WebKit 317153).
  // iOS 27은 그 모드에서 상단 블러를 끌 수 없다. 상태바 색은 화면의 StatusBarColor가 정한다
  appleWebApp: { capable: true, title: "핏다이닝" },
};

export const viewport: Viewport = {
  // 브라우저 상단바를 페이지 바탕(--color-surface)과 같은 흰색으로 맞춘다
  themeColor: "#ffffff",
  // 자동 여백을 끄고 화면 전체에 그린다. 홈 인디케이터 같은 시스템 영역은 env(safe-area-inset-*)로 피한다
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
