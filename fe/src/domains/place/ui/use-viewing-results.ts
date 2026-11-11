import { useInfiniteQuery } from "@tanstack/react-query";

import { placeQueries } from "../api/place-queries";
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
// 여기서는 캐시를 읽고, loadMore일 때만 다음 페이지를 새로 받는다. 근처 응답도 거르지 않고 서버 순서 그대로다(spec 41번)
function useEntryResults(
  target: HistoryEntry | undefined,
  { loadMore: canLoadMore }: { loadMore: boolean },
) {
  const entry = target ?? NO_ENTRY;
  const query = useInfiniteQuery({
    ...placeQueries.search(entry.id, entry.kind, entry.request),
    enabled: Boolean(target),
  });

  const pages = query.data?.pages ?? [];
  const firstPage = pages[0];
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

  return {
    firstPage,
    // 지금 보이는 카드. 순위 번호는 이 목록의 순서다
    cards: allCards,
    hasNextPage: canLoadMore && query.hasNextPage,
    loadMore,
    // 다음 페이지를 받지 못했을 때. 다시 누를 때까지 더 부르지 않는다
    loadMoreFailed: query.isFetchNextPageError,
  };
}
