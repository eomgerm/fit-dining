import { Suspense } from "react";

import { ReviewWriteScreen } from "./review-write-screen";

// 리뷰 작성 화면(/place/review?id=). 주소의 id는 요청마다 달라 Suspense 안에서 읽는다
export default function ReviewWritePage() {
  return (
    <Suspense>
      <ReviewWriteScreen />
    </Suspense>
  );
}
