import { CATEGORY_LABELS } from "./place-labels";
import type {
  CategoryGroup,
  MapBounds,
  PlaceCard,
  PlaceSearchResponse,
  SearchConditions,
  SearchRequest,
} from "./place-types";
import {
  runnableRequest,
  type LocationState,
  type StoredSearchRequest,
} from "./search-request";

// 서버가 모르는 검색 화면 상태. 검색 응답(페이지와 커서)은 TanStack Query 캐시에 항목 id별로 있고,
// 여기에는 지금 thread의 요청 기록 메타 정보와 화면 상태만 둔다. 메모리에만 있어 재로드하면 사라진다.
// thread 자체는 thread-storage가 비회원은 기기에, 회원은 서버에 저장한다(spec 53번, search-thread D-8)

export type EntryKind = "new" | "followUp" | "region";

// 앱을 연 뒤 처음 얻은 위치로 지도를 한 번 옮기는 일의 상태(spec 62번). pending이면 아직 옮기지 않았고,
// applying이면 한 화면이 옮기는 중이며, done이면 다시 옮기지 않는다
export type InitialView = "pending" | "applying" | "done";

// 처음 이동을 끝낸 쪽(spec 70번). initial은 처음 조회의 결과나 처음 panTo의 끝, button은 "내 위치"의 이동,
// user는 사용자의 끌기·확대·축소, fit은 결과 맞춤 이동, map은 지도 실패다
export type InitialViewEnd = "initial" | "button" | "user" | "fit" | "map";

// 홈 주변 카드의 영역(spec 72번, 73번). entry는 홈 진입 번호이고, bounds는 그 진입에서 확정한 정규화 영역,
// coverTop은 그때 잰 덮는 UI의 위 끝(화면 좌표)이다. 확정 전에는 bounds가 없다
export type HomeArea = {
  entry: number;
  bounds?: MapBounds;
  coverTop?: number;
};

// 앱을 열 때의 위치 조회 결과 중 화면이 알려야 하는 것(spec 63번)
export type LocationNotice = "denied" | "failed";

// 요청 기록(5-07)의 한 줄. 지금 thread에서 성공한 첫 페이지 요청 하나다
export type HistoryEntry = {
  id: string;
  kind: EntryKind;
  // 기록에 보이는 입력 문장. "이 지역에서 검색"은 이 문장을 query로 보낸다
  sentence: string;
  // 실행 요청(첫 페이지 요청 본문). 다음 페이지와 "이 조건으로 다시 검색"이 다시 보내고 후속 조건이 영역을 잇는다.
  // 다시 연 thread의 region 기록이 실행 불가면 없다(spec 67번)
  request?: SearchRequest;
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
  // 상세 화면이 핏 점수와 추천 이유를 꺼내 쓴다
  latestCards: ReadonlyMap<number, PlaceCard>;
  initialView: InitialView;
  // "내 위치"가 처음 이동을 가져갔는지. 가진 동안은 처음 조회와 처음 panTo의 끝으로 done이 되지 않는다
  initialOwnedByButton: boolean;
  // 처음 이동을 끝낸 쪽. 사용자가 끝냈으면 처음 홈 요청은 지도가 멈춘 뒤의 화면으로 나간다
  initialEndedBy?: InitialViewEnd;
  home: HomeArea;
  // 아직 아무 화면도 띄우지 않은 위치 알림. 지금 보이는 화면이 한 번 가져가 띄운다
  locationNotice?: LocationNotice;
  // 로그인 세션이 바뀌어 처음으로 되돌린 횟수. 그 전에 시작한 요청의 응답은 버린다(search-thread D-6)
  epoch: number;
};

type AddEntryInput = {
  id: string;
  kind: EntryKind;
  baseId?: string;
  request: SearchRequest;
  response: PlaceSearchResponse;
};

// 다시 여는 thread의 요청. 시각은 그때 값이고 요청은 저장된 모양 그대로다
type RestoredEntryInput = Omit<AddEntryInput, "request"> & {
  at: number;
  request: StoredSearchRequest;
};

// 기록 항목을 만든다. 문장은 부르는 쪽이 요청의 query로 넘긴다("이 지역에서 검색"도 기준 요청의 문장을 그대로 다시 보낸다)
function toEntry({
  id,
  kind,
  baseId,
  sentence,
  request,
  response,
  at,
}: Omit<AddEntryInput, "request"> & {
  at: number;
  sentence: string;
  request: SearchRequest | undefined;
}): HistoryEntry {
  const entry: HistoryEntry = {
    id,
    kind,
    sentence,
    ...(request && { request }),
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
    latestCards: new Map(),
    initialView: "pending",
    initialOwnedByButton: false,
    home: { entry: 0 },
    epoch: 0,
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

    // 이 store가 사는 동안이 페이지 세션 하나다. 앱을 열 때의 위치 조회를 페이지 세션에 한 번만 하는 데 쓴다
    pageSession: {},

    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    // 지금 thread 끝에 쌓는다. thread가 없으면(첫 화면의 새 검색) 새 thread를 연다
    addEntry(input: AddEntryInput) {
      const entry = toEntry({
        ...input,
        sentence: input.request.query,
        at: now(),
      });
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

    // 최근 검색에서 고른 thread로 바꾼다. 마지막 요청이 지금 보는 요청이 된다.
    // 저장된 요청은 바꾸지 않고 실행 요청으로 옮겨 둔다(spec 67번)
    openThread(threadId: string, turns: RestoredEntryInput[]) {
      const entries = turns.map((turn) =>
        toEntry({
          ...turn,
          sentence: turn.request.query,
          request: runnableRequest(turn),
        }),
      );
      const last = turns[turns.length - 1];
      update({
        threadId,
        entries,
        viewingId: last?.id,
        pastId: undefined,
        selectedPlaceId: undefined,
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
      });
    },

    select(placeId: number | undefined) {
      update({ selectedPlaceId: placeId });
    },

    setLocation(location: LocationState) {
      update({ location });
    },

    // 처음 이동을 이 화면이 가져간다. 이미 다른 화면이 가져갔거나 끝났으면 false다
    startInitialView() {
      if (state.initialView !== "pending") return false;
      update({ initialView: "applying" });
      return true;
    },

    // "내 위치"가 남은 처음 이동을 가져간다(pending이든 applying이든). 이미 done이면 그대로다(spec 70번)
    takeInitialViewByButton() {
      if (state.initialView === "done") return;
      update({ initialView: "applying", initialOwnedByButton: true });
    },

    // 처음 이동이 끝났거나 더 할 필요가 없다(위치를 못 얻음, "내 위치", 사용자가 지도를 움직임, 맞춤 이동, 지도 실패).
    // "내 위치"가 가진 동안은 처음 조회의 결과와 처음 panTo의 끝(initial)으로 끝내지 않는다
    finishInitialView(by: InitialViewEnd = "initial") {
      if (state.initialView === "done") return;
      if (state.initialOwnedByButton && by === "initial") return;
      update({ initialView: "done", initialEndedBy: by });
    },

    // 홈 진입. 번호를 올리고 영역을 비운다. 그 진입의 영역은 setHomeBounds가 확정한다(spec 73번)
    beginHomeEntry() {
      update({ home: { entry: state.home.entry + 1 } });
    },

    // 지금 홈 진입의 영역을 확정한다. 지난 진입의 늦은 결과는 버린다(spec 72번)
    setHomeBounds(
      entry: number,
      bounds: MapBounds,
      coverTop: number | undefined,
    ) {
      if (entry !== state.home.entry) return;
      update({ home: { entry, bounds, coverTop } });
    },

    noticeLocation(notice: LocationNotice) {
      update({ locationNotice: notice });
    },

    takeLocationNotice() {
      const notice = state.locationNotice;
      if (notice) update({ locationNotice: undefined });
      return notice;
    },

    // 로그인 세션이 바뀌면 처음 화면으로 되돌린다. 현재 위치, 처음 이동, 위치 알림은 기기의 것이라 남긴다
    reset() {
      update({
        threadId: undefined,
        entries: [],
        viewingId: undefined,
        pastId: undefined,
        selectedPlaceId: undefined,
        latestCards: new Map(),
        // 홈 영역을 비워 다음에 홈이 보일 때 새로 확정한다(숨은 동안 바뀐 경우 포함, spec 73번)
        home: { entry: state.home.entry + 1 },
        epoch: state.epoch + 1,
      });
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

// 결과 패널 제목. 기준 요청을 따라 거슬러 올라간 새 검색의 문장이고, 후속 입력은 칩으로만 보인다(D-97)
export function requestTitle(entries: HistoryEntry[], id?: string) {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  let entry = id ? byId.get(id) : undefined;
  while (entry?.baseId && byId.has(entry.baseId))
    entry = byId.get(entry.baseId);
  return entry?.sentence;
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
