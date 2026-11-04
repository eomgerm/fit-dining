import Link from "next/link";

import { OnboardingEntry } from "./onboarding-entry";
import { homeMetadata, siteDescription } from "./site";

// 홈(/)의 기본 화면인 온보딩. 로그인·비회원 표시 쿠키가 있으면 next.config가 검색 홈(app/home)으로 rewrite한다
export const metadata = homeMetadata;

// Google 사이트 이름의 가장 강한 신호다. 홈에만 둔다(Search Central "Site names")
const websiteJsonLd = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "핏다이닝",
  alternateName: "Fit Dining",
  url: "https://fitdining.co.kr/",
});

export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: websiteJsonLd }}
      />
      {/* 온보딩 첫 화면은 버튼과 영상뿐이다. JS를 실행하지 않는 크롤러(AI 검색 봇 등)와
          JS를 끈 사용자가 읽을 소개다 */}
      <noscript>
        <main className="mx-auto w-full max-w-110 p-6 text-ink">
          <h1 className="text-headline-md">핏다이닝</h1>
          <p className="mt-3">{siteDescription}</p>
          <p className="mt-3">
            식당과 카페를 핏 점수, 추천 이유, 근거 리뷰와 함께 보여 줍니다.
            핏다이닝을 쓰려면 자바스크립트를 켜 주세요.
          </p>
          <p className="mt-3 flex gap-4">
            <Link href="/terms">서비스 이용약관</Link>
            <Link href="/privacy">개인정보처리방침</Link>
          </p>
        </main>
      </noscript>
      <OnboardingEntry />
    </>
  );
}
