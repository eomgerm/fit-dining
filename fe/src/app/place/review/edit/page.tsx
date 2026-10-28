import { Suspense } from "react";

import { ReviewEditScreen } from "./review-edit-screen";

// 리뷰 수정 화면(/place/review/edit?id=<장소 id>&review=<리뷰 id>). 주소는 요청마다 달라 Suspense 안에서 읽는다
export default function ReviewEditPage() {
  return (
    <Suspense>
      <ReviewEditScreen />
    </Suspense>
  );
}
