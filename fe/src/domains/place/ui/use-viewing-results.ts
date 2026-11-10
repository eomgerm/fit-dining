import { useInfiniteQuery } from "@tanstack/react-query";

import { placeQueries } from "../api/place-queries";
import { filterNearby, orderNearby, YEOKSAM_STATION } from "../model/nearby";
import { searchStore, type HistoryEntry } from "../model/search-store";
import { useSearchStore } from "./use-search-store";

const NO_ENTRY: HistoryEntry = {
  id: "",
  kind: "new",
  sentence: "",
  request: { query: "" },
  conditions: {},
  totalCount: 0,
  at: 0,
};

// 지금 보는 요청의 결과. 다음 페이지를 이어 받는다
export function useViewingResults() {
  const { entries, viewingId } = useSearchStore();
  const viewing = entries.find(({ id }) => id === viewingId);
  return { viewing, ...useEntryResults(viewing, { loadMore: true }) };
}

// 과거 결과 화면의 결과. 그때 받아 둔 페이지만 보이고 더 부르지 않는다(spec 57번)
export function usePastResults() {
  const { entries, pastId } = useSearchStore();
  const past = entries.find(({ id }) => id === pastId);
  return { past, ...useEntryResults(past, { loadMore: false }) };
}

// 한 요청 기록 항목의 결과. 첫 페이지는 기록에 넣기 전에(다시 연 thread면 저장한 응답으로) 캐시에 받아 두었으므로
// 여기서는 캐시를 읽고, loadMore일 때만 다음 페이지를 새로 받는다. 근처 응답이면 위치가 있을 때 반경으로 거른다
function useEntryResults(
  target: HistoryEntry | undefined,
  { loadMore: canLoadMore }: { loadMore: boolean },
) {
  const { location, initialView } = useSearchStore();
  const entry = target ?? NO_ENTRY;
  const query = useInfiniteQuery({
    ...placeQueries.search(entry.id, entry.request),
    enabled: Boolean(target),
  });

  const pages = query.data?.pages ?? [];
  const firstPage = pages[0];
  const nearby = firstPage?.nearby ?? false;
  const allCards = pages.flatMap(({ items }) => items);

  // 다음 페이지의 카드도 상세 화면이 쓸 수 있게 둔다. 받은 그때만 기록해야
  // 예전 요청을 다시 볼 때 더 최근에 받은 카드를 덮어쓰지 않는다
  function loadMore() {
    if (!canLoadMore || query.isFetchingNextPage) return;
    const pageCount = pages.length;
    query.fetchNextPage().then(({ data }) => {
      if (data && data.pages.length > pageCount) {
        searchStore.recordCards(data.pages[data.pages.length - 1].items);
      }
    });
  }

  // 근처 응답을 받아도 위치를 요청하지 않는다. 앱을 열 때의 위치 결정과 처음 이동이 끝나기 전까지만 기다리고,
  // 그 뒤에도 위치가 없으면 거르지 않고 보인다(spec 41번)
  const locating = nearby && initialView !== "done";
  // 점수가 없는 근처 응답은 기준 지점에서 가까운 순이다. 위치가 있으면 그 위치, 없으면 역삼역이 기준이다
  const origin = location.status === "ok" ? location.here : YEOKSAM_STATION;
  const nearbyCards = orderNearby(
    allCards,
    location.status === "ok" ? filterNearby(allCards, location.here) : allCards,
    origin,
  );
  const cards = nearby ? nearbyCards : allCards;

  return {
    firstPage,
    // 지금 보이는 카드. 순위 번호는 이 목록의 순서다
    cards: locating ? [] : cards,
    locating,
    // 근처 응답인데 위치를 얻지 못해 거르지 않고 보여 줄 때
    unfilteredNearby: nearby && location.status === "failed",
    hasNextPage: canLoadMore && query.hasNextPage,
    loadMore,
    // 다음 페이지를 받지 못했을 때. 다시 누를 때까지 더 부르지 않는다
    loadMoreFailed: query.isFetchNextPageError,
  };
}
