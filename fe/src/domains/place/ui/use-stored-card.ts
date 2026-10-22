import { useQueryClient } from "@tanstack/react-query";

import { placeQueries } from "../api/place-queries";
import { useSearchStore } from "./use-search-store";

// 상세 화면의 핏 점수, 추천 이유, 주의점은 검색에서 받은 카드의 값이다.
// 지금 보는 요청에 그 장소의 카드가 있으면 그것을, 없으면 가장 최근에 받은 카드를 쓴다.
// 주소를 직접 열었거나 재로드했으면 없다
export function useStoredCard(placeId: number) {
  const queryClient = useQueryClient();
  const { entries, viewingId, latestCards } = useSearchStore();
  const viewing = entries.find(({ id }) => id === viewingId);
  const viewingCard = viewing
    ? queryClient
        .getQueryData(placeQueries.search(viewing.id, viewing.request).queryKey)
        ?.pages.flatMap(({ items }) => items)
        .find(({ place }) => place.id === placeId)
    : undefined;
  return viewingCard ?? latestCards.get(placeId);
}
