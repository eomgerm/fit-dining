import { useQueryClient } from "@tanstack/react-query";

import { placeQueries } from "../api/place-queries";
import type { PlaceCard } from "../model/place-types";
import { searchSentence } from "../model/search-store";
import { useSearchStore } from "./use-search-store";

// 상세 화면의 핏 점수와 추천 이유는 검색에서 받은 카드의 값이다.
// 과거 결과 화면에서 들어왔으면 그 스냅샷의 카드를, 그 밖에는 지금 보는 요청에 그 장소의 카드가 있으면 그것을,
// 없으면 가장 최근에 받은 카드를 쓴다.
// 주소를 직접 열었거나 재로드했으면 없다
export function useStoredCard(placeId: number) {
  return useStoredSearch(placeId).card;
}

// 카드와 그 카드를 받은 검색의 요청 문장. 요청 문장은 상세 추천 이유 API에 보낸다.
// 가장 최근에 받은 카드(홈 주변 카드 등)는 어느 요청의 것인지 몰라 문장이 없다
export function useStoredSearch(placeId: number): {
  card?: PlaceCard;
  sentence?: string;
} {
  const queryClient = useQueryClient();
  const { entries, viewingId, pastId, latestCards } = useSearchStore();
  const source = entries.find(({ id }) => id === (pastId ?? viewingId));
  const sourceCard = source
    ? queryClient
        .getQueryData(
          placeQueries.search(source.id, source.kind, source.request).queryKey,
        )
        ?.pages.flatMap(({ items }) => items)
        .find(({ place }) => place.id === placeId)
    : undefined;
  if (sourceCard && source) {
    return { card: sourceCard, sentence: searchSentence(entries, source.id) };
  }
  return { card: latestCards.get(placeId) };
}
