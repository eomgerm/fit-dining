import { Suspense } from "react";

import { PlaceDetailScreen } from "@/domains/place/ui/place-detail-screen";

// ?id는 useSearchParams로 읽는다. 미리 렌더링할 때 그 아래를 브라우저에서 그리도록 Suspense로 감싼다
export default function PlaceDetailPage() {
  return (
    <Suspense>
      <PlaceDetailScreen />
    </Suspense>
  );
}
