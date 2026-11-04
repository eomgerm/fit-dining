import type { Metadata } from "next";

// 검색 결과·링크 미리보기 설명과 홈의 noscript 소개가 같은 문구를 쓴다
export const siteDescription =
  "원하는 조건을 자연스럽게 검색해보세요. 내 취향에 딱 맞는 장소를 추천해드려요.";

// 홈(/)은 표시 쿠키에 따라 온보딩(app/page.tsx)이나 검색 홈(app/home/page.tsx)을 준다. 두 화면이 같은 제목·주소를 쓴다.
// ?view=saved도 같은 홈으로 모은다
export const homeMetadata: Metadata = {
  title: { absolute: "핏다이닝 | 취향 맞춤 식당·카페 추천" },
  alternates: { canonical: "/" },
};
