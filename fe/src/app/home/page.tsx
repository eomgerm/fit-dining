import { Suspense } from "react";

import { homeMetadata } from "../site";
import { HomeScreen } from "./home-screen";

// 홈(/)의 검색 홈. next.config가 로그인·비회원 표시 쿠키가 있는 / 요청을 여기로 rewrite한다.
// 주소로 직접 오면 /로 보낸다
export const metadata = homeMetadata;

// 메인은 ?view=saved를 useSearchParams로 읽는다. 미리 렌더링할 때 그 아래를 브라우저에서 그리도록 Suspense로 감싼다
export default function HomePage() {
  return (
    <Suspense>
      <HomeScreen />
    </Suspense>
  );
}
