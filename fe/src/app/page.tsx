import type { Metadata } from "next";
import { Suspense } from "react";

import { HomeEntry } from "./home-entry";

// ?view=saved도 같은 홈으로 모은다
export const metadata: Metadata = { alternates: { canonical: "/" } };

// 메인은 ?view=saved를 useSearchParams로 읽는다. 미리 렌더링할 때 그 아래를 브라우저에서 그리도록 Suspense로 감싼다
export default function Home() {
  return (
    <Suspense>
      <HomeEntry />
    </Suspense>
  );
}
