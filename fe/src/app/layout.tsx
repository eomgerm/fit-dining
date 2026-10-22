import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { Providers } from "./providers";

// ponytail: 가변 폰트 전체(2MB)를 한 번에 받는다. 첫 로딩이 문제되면 Pretendard dynamic subset으로 바꾼다
const pretendard = localFont({
  src: "./fonts/PretendardVariable.woff2",
  // 생략하면 WebKit에서 굵기가 틀리게 그려진다(Pretendard README)
  weight: "45 920",
  variable: "--font-pretendard",
});

export const metadata: Metadata = {
  title: "Fit Dining",
  description: "오늘 끌리는 곳, 내 취향으로 찾기",
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
      </body>
    </html>
  );
}
