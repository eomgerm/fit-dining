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
// 여기에는 지금 thread의 요청 기록 메타 정보와 화면 상태만 둔다. 메모리에만 있어 재로드하면 사라진다.
// thread 자체는 thread-storage가 기기에 저장한다(spec 53번)

export type EntryKind = "new" | "followUp" | "region";

// 요청 기록(5-07)의 한 줄. 지금 thread에서 성공한 첫 페이지 요청 하나다
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
  // 지금 thread. 첫 새 검색이 성공하면 생기고 "새 검색"을 누르면 닫힌다
  threadId?: string;
  // 지금 thread의 요청 기록
  entries: HistoryEntry[];
  viewingId?: string;
  // 열린 과거 결과 화면의 항목. 지금 보는 요청은 바꾸지 않는다
  pastId?: string;
  selectedPlaceId?: number;
  location: LocationState;
  // "이 지역에서 검색"을 누른 뒤 "새 검색" 전까지 켜져 있다
  regionLocked: boolean;
  // 상세 화면이 핏 점수와 추천 이유를 꺼내 쓴다
  latestCards: ReadonlyMap<number, PlaceCard>;
  // 화면을 열 때의 위치 권한 확인을 이번 페이지 세션에 이미 했는지. 상세에서 돌아와도 다시 하지 않는다
  openLocationChecked: boolean;
};

type AddEntryInput = {
  id: string;
  kind: EntryKind;
  baseId?: string;
  request: PlaceSearchRequest;
  response: PlaceSearchResponse;
};

// 다시 여는 thread의 요청. 시각은 그때 값이다
type RestoredEntryInput = AddEntryInput & { at: number };

// "이 지역에서 검색"도 기준 요청의 문장을 그대로 다시 보내므로 문장은 늘 요청의 query다
function toEntry({
  id,
  kind,
  baseId,
  request,
  response,
  at,
}: RestoredEntryInput): HistoryEntry {
  const entry: HistoryEntry = {
    id,
    kind,
    sentence: request.query,
    request,
    conditions: response.conditions,
    totalCount: response.totalCount,
    at,
    ...(baseId && { baseId }),
  };
  const category = dominantCategory(response.items);
  if (category) entry.category = category;
  return entry;
}

export function createSearchStore(now: () => number = Date.now) {
  let state: SearchState = {
    entries: [],
    location: { status: "idle" },
    regionLocked: false,
    latestCards: new Map(),
    openLocationChecked: false,
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

    // 지금 thread 끝에 쌓는다. thread가 없으면(첫 화면의 새 검색) 새 thread를 연다
    addEntry(input: AddEntryInput) {
      const entry = toEntry({ ...input, at: now() });
      update({
        threadId: state.threadId ?? nextThreadId(),
        entries: [...state.entries, entry],
        viewingId: entry.id,
        pastId: undefined,
        selectedPlaceId: undefined,
        latestCards: withCards(input.response.items),
      });
      return entry;
    },

    // 최근 검색에서 고른 thread로 바꾼다. 마지막 요청이 지금 보는 요청이 된다
    openThread(threadId: string, turns: RestoredEntryInput[]) {
      const entries = turns.map(toEntry);
      const last = turns[turns.length - 1];
      update({
        threadId,
        entries,
        viewingId: last?.id,
        pastId: undefined,
        selectedPlaceId: undefined,
        regionLocked: false,
        latestCards: last ? withCards(last.response.items) : state.latestCards,
      });
    },

    // 다음 페이지처럼 기록 항목을 만들지 않는 응답의 카드
    recordCards(cards: PlaceCard[]) {
      update({ latestCards: withCards(cards) });
    },

    // "여기서 이어 검색"
    view(id: string) {
      update({ viewingId: id, pastId: undefined, selectedPlaceId: undefined });
    },

    // "결과 보기"의 과거 결과 화면. 지금 보는 요청은 그대로다
    openPast(id: string) {
      update({ pastId: id, selectedPlaceId: undefined });
    },

    closePast() {
      update({ pastId: undefined, selectedPlaceId: undefined });
    },

    // 지금 thread를 닫는다. 다음 새 검색이 새 thread를 연다
    startNewSearch() {
      update({
        threadId: undefined,
        entries: [],
        viewingId: undefined,
        pastId: undefined,
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

    markOpenLocationChecked() {
      update({ openLocationChecked: true });
    },
  };
}

export type SearchStore = ReturnType<typeof createSearchStore>;

export const searchStore = createSearchStore();

// 첫 페이지를 받기 전에 쿼리 키를 정하려고 미리 id를 만든다. 다시 연 thread의 id와 겹치지 않게 무작위다
export function nextEntryId() {
  return `entry-${crypto.randomUUID()}`;
}

function nextThreadId() {
  return `thread-${crypto.randomUUID()}`;
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
