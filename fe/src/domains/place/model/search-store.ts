import { CATEGORY_LABELS } from "./place-labels";
import type {
  CategoryGroup,
  PlaceCard,
  PlaceSearchRequest,
  PlaceSearchResponse,
  SearchConditions,
} from "./place-types";
import type { LocationState } from "./search-request";

// 서버가 모르는 검색 화면 상태. 검색 응답(페이지와 커서)은 TanStack Query 캐시에 항목 id별로 있고,
// 여기에는 요청 기록의 메타 정보만 둔다. 메모리에만 있어 재로드하면 사라진다(보관 방식은 미결)

export type EntryKind = "new" | "followUp" | "region";

// 요청 기록(5-07)의 한 줄. 성공한 첫 페이지 요청 하나다
export type HistoryEntry = {
  id: string;
  kind: EntryKind;
  // 기록에 보이는 입력 문장
  sentence: string;
  // 첫 페이지 요청 본문. 다음 페이지와 "이 지역에서 검색"이 이것을 다시 보낸다
  request: PlaceSearchRequest;
  // 첫 페이지 응답의 conditions. 이 항목을 기준으로 한 후속 조건이 돌려보낸다
  conditions: SearchConditions;
  totalCount: number;
  // 근처 필터 전 첫 페이지 항목에서 가장 많은 업종. 0건이면 없다
  category?: CategoryGroup;
  at: number;
  // 후속 조건과 "이 지역에서 검색"의 기준 항목
  baseId?: string;
};

export type SearchState = {
  entries: HistoryEntry[];
  viewingId?: string;
  selectedPlaceId?: number;
  location: LocationState;
  // "이 지역에서 검색"을 누른 뒤 "새 검색" 전까지 켜져 있다
  regionLocked: boolean;
  // 상세 화면이 핏 점수와 추천 이유를 꺼내 쓴다
  latestCards: ReadonlyMap<number, PlaceCard>;
};

type AddEntryInput = {
  id: string;
  kind: EntryKind;
  baseId?: string;
  request: PlaceSearchRequest;
  response: PlaceSearchResponse;
};

export function createSearchStore(now: () => number = Date.now) {
  let state: SearchState = {
    entries: [],
    location: { status: "idle" },
    regionLocked: false,
    latestCards: new Map(),
  };
  const listeners = new Set<() => void>();

  function update(patch: Partial<SearchState>) {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
  }

  function withCards(cards: PlaceCard[]) {
    const latestCards = new Map(state.latestCards);
    for (const card of cards) latestCards.set(card.place.id, card);
    return latestCards;
  }

  return {
    getSnapshot: () => state,

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    addEntry(input: AddEntryInput) {
      const { id, kind, baseId, request, response } = input;
      // "이 지역에서 검색"도 기준 요청의 문장을 그대로 다시 보내므로 문장은 늘 요청의 query다
      const entry: HistoryEntry = {
        id,
        kind,
        sentence: request.query,
        request,
        conditions: response.conditions,
        totalCount: response.totalCount,
        at: now(),
        ...(baseId && { baseId }),
      };
      const category = dominantCategory(response.items);
      if (category) entry.category = category;

      update({
        entries: [...state.entries, entry],
        viewingId: id,
        selectedPlaceId: undefined,
        latestCards: withCards(response.items),
      });
    },

    // 다음 페이지처럼 기록 항목을 만들지 않는 응답의 카드
    recordCards(cards: PlaceCard[]) {
      update({ latestCards: withCards(cards) });
    },

    // "결과 보기", "여기서 이어 검색"
    view(id: string) {
      update({ viewingId: id, selectedPlaceId: undefined });
    },

    startNewSearch() {
      update({
        viewingId: undefined,
        selectedPlaceId: undefined,
        regionLocked: false,
      });
    },

    select(placeId: number | undefined) {
      update({ selectedPlaceId: placeId });
    },

    setLocation(location: LocationState) {
      update({ location });
    },

    lockRegion() {
      update({ regionLocked: true });
    },
  };
}

export type SearchStore = ReturnType<typeof createSearchStore>;

export const searchStore = createSearchStore();

let entryCount = 0;

// 첫 페이지를 받기 전에 쿼리 키를 정하려고 미리 id를 만든다
export function nextEntryId() {
  entryCount += 1;
  return `entry-${entryCount}`;
}

const CATEGORY_ORDER = Object.keys(CATEGORY_LABELS) as CategoryGroup[];

export function dominantCategory(cards: PlaceCard[]) {
  const counts = new Map<CategoryGroup, number>();
  for (const { place } of cards) {
    counts.set(place.categoryGroup, (counts.get(place.categoryGroup) ?? 0) + 1);
  }
  let best: CategoryGroup | undefined;
  let bestCount = 0;
  for (const category of CATEGORY_ORDER) {
    const count = counts.get(category) ?? 0;
    if (count > bestCount) [best, bestCount] = [category, count];
  }
  return best;
}

// "오후 3:05"
export function formatClock(ms: number) {
  const date = new Date(ms);
  const hours = date.getHours();
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${hours < 12 ? "오전" : "오후"} ${hours % 12 || 12}:${minutes}`;
}

// "카페 32곳 · 오후 3:05"
export function historyMeta(entry: HistoryEntry) {
  const count =
    entry.totalCount === 0 || !entry.category
      ? `결과 ${entry.totalCount}곳`
      : `${CATEGORY_LABELS[entry.category]} ${entry.totalCount}곳`;
  return `${count} · ${formatClock(entry.at)}`;
}

// 기준 요청이 직전 요청이 아닐 때만 "첫 요청에서 이어 검색", "2번째 요청에서 이어 검색"
export function continuedFrom(entries: HistoryEntry[], entry: HistoryEntry) {
  if (!entry.baseId) return;
  const index = entries.indexOf(entry);
  const baseIndex = entries.findIndex(({ id }) => id === entry.baseId);
  if (baseIndex < 0 || baseIndex === index - 1) return;
  const order = baseIndex === 0 ? "첫" : `${baseIndex + 1}번째`;
  return `${order} 요청에서 이어 검색`;
}

// 지금 보는 요청에서 기준 요청을 따라 새 검색까지 거슬러 올라가며 만난 후속 입력(오래된 순서)
export function followUpChips(entries: HistoryEntry[], viewingId?: string) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const chips: string[] = [];
  for (
    let entry = viewingId ? byId.get(viewingId) : undefined;
    entry;
    entry = entry.baseId ? byId.get(entry.baseId) : undefined
  ) {
    if (entry.kind === "followUp") chips.unshift(entry.sentence);
  }
  return chips;
}
