import type { Metadata } from "next";

// dev와 prod가 같은 이미지라 환경변수 대신 prod 주소로 고정한다. dev는 엣지 게이트가 크롤러를 막는다
export const siteUrl = "https://fitdining.co.kr";

// 페이지가 openGraph를 정하면 레이아웃의 openGraph를 통째로 바꾸므로(얕은 병합) 공통 값을 함께 펼친다
export const siteOpenGraph = {
  type: "website",
  siteName: "핏다이닝",
  locale: "ko_KR",
} as const;

// 서비스 기본 공유 이미지(opengraph-image.png 파일 규칙의 주소). openGraph를 정하는 페이지는 파일 규칙 이미지가 빠지므로
// 직접 넣는다. alt는 opengraph-image.alt.txt와 같다
export const siteImage = {
  url: "/opengraph-image.png",
  width: 1200,
  height: 630,
  alt: '핏다이닝 로고와 "내 취향에 맞춘 미식 여정" 문구',
};

// 검색 결과·링크 미리보기 설명과 홈의 noscript 소개가 같은 문구를 쓴다
export const siteDescription =
  "원하는 조건을 자연스럽게 검색해보세요. 내 취향에 딱 맞는 장소를 추천해드려요.";

// 홈(/)은 표시 쿠키에 따라 온보딩(app/page.tsx)이나 검색 홈(app/home/page.tsx)을 준다. 두 화면이 같은 제목·주소를 쓴다.
// ?view=saved도 같은 홈으로 모은다
export const homeMetadata: Metadata = {
  title: { absolute: "핏다이닝 | 취향 맞춤 식당·카페 추천" },
  alternates: { canonical: "/" },
};
