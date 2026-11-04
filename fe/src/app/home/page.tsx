import { Suspense } from "react";

import { SearchScreenSkeleton } from "@/domains/place/ui/search-screen-skeleton";
import { homeMetadata } from "../site";
import { HomeScreen } from "./home-screen";

// 홈(/)의 검색 홈. next.config가 로그인·비회원 표시 쿠키가 있는 / 요청을 여기로 rewrite한다.
// 주소로 직접 오면 /로 보낸다
export const metadata = homeMetadata;

// 메인은 ?view=saved를 useSearchParams로 읽어 미리 렌더링할 때 그 아래를 브라우저가 그린다.
// 첫 HTML에는 화면 틀을 둔다. 요청 때 서버에서 그리면 앱 안에서 홈으로 올 때마다 서버 응답을 기다린다
export default function HomePage() {
  return (
    <Suspense fallback={<SearchScreenSkeleton />}>
      <HomeScreen />
    </Suspense>
  );
}
