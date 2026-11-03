import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { HomeEntry } from "./home-entry";
import { siteDescription } from "./site";

// ?view=saved도 같은 홈으로 모은다
export const metadata: Metadata = {
  title: { absolute: "핏다이닝 | 취향 맞춤 식당·카페 추천" },
  alternates: { canonical: "/" },
};

// Google 사이트 이름의 가장 강한 신호다. 홈에만 둔다(Search Central "Site names")
const websiteJsonLd = JSON.stringify({
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "핏다이닝",
  alternateName: "Fit Dining",
  url: "https://fitdining.co.kr/",
});

// 메인은 ?view=saved를 useSearchParams로 읽는다. 미리 렌더링할 때 그 아래를 브라우저에서 그리도록 Suspense로 감싼다
export default function Home() {
  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: websiteJsonLd }}
      />
      {/* 홈은 브라우저에서만 그려 서버 HTML이 비어 있다. JS를 실행하지 않는 크롤러(AI 검색 봇 등)와
          JS를 끈 사용자가 읽을 소개다 */}
      <noscript>
        <main className="mx-auto w-full max-w-110 p-6 text-ink">
          <h1 className="text-headline-md">핏다이닝</h1>
          <p className="mt-3">{siteDescription}</p>
          <p className="mt-3">
            강남역·역삼역·선릉역 주변 식당과 카페를 핏 점수, 추천 이유, 근거
            리뷰와 함께 보여 줍니다. 핏다이닝을 쓰려면 자바스크립트를 켜 주세요.
          </p>
          <p className="mt-3 flex gap-4">
            <Link href="/terms">서비스 이용약관</Link>
            <Link href="/privacy">개인정보처리방침</Link>
          </p>
        </main>
      </noscript>
      <Suspense>
        <HomeEntry />
      </Suspense>
    </>
  );
}
