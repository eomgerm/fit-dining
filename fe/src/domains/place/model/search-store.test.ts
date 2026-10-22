import { describe, expect, it, vi } from "vitest";

import type {
  CategoryGroup,
  PlaceCard,
  PlaceSearchResponse,
} from "./place-types";
import {
  continuedFrom,
  createSearchStore,
  dominantCategory,
  followUpChips,
  formatClock,
  historyMeta,
  type HistoryEntry,
} from "./search-store";

function card(id: number, categoryGroup: CategoryGroup = "CAFE"): PlaceCard {
  return {
    place: {
      id,
      name: `장소 ${id}`,
      categoryGroup,
      station: "YEOKSAM",
      lat: 37.5,
      lng: 127.03,
    },
    score: 80,
    labels: ["조용해요", "넓어요"],
    openStatus: "OPEN",
    reasons: [],
    scoreItems: [],
  };
}

function response(
  overrides: Partial<PlaceSearchResponse> = {},
): PlaceSearchResponse {
  return {
    conditions: {},
    nearby: false,
    totalCount: 2,
    items: [card(1), card(2)],
    ...overrides,
  };
}

const BOUNDS = { swLat: 37.49, swLng: 127.02, neLat: 37.51, neLng: 127.05 };

const at = (h: number, m: number) => new Date(2026, 9, 22, h, m).getTime();

function setup() {
  let clock = at(15, 5);
  const store = createSearchStore(() => clock);
  return { store, setClock: (ms: number) => (clock = ms) };
}

describe("createSearchStore", () => {
  it("성공한 첫 페이지 요청을 기록에 쌓고 그 요청을 지금 보는 요청으로 둔다", () => {
    const { store } = setup();

    store.addEntry({
      id: "a",
      kind: "new",
      request: { query: "역삼 카페" },
      response: response({ conditions: { area: "역삼" }, totalCount: 32 }),
    });

    const state = store.getSnapshot();
    expect(state.viewingId).toBe("a");
    expect(state.entries).toEqual([
      {
        id: "a",
        kind: "new",
        sentence: "역삼 카페",
        request: { query: "역삼 카페" },
        conditions: { area: "역삼" },
        totalCount: 32,
        category: "CAFE",
        at: at(15, 5),
      },
    ]);
  });

  it("후속 조건은 기준 항목을 기억한다", () => {
    const { store } = setup();
    store.addEntry({
      id: "a",
      kind: "new",
      request: { query: "역삼 카페" },
      response: response(),
    });

    store.addEntry({
      id: "b",
      kind: "followUp",
      baseId: "a",
      request: { query: "더 조용하게", previousConditions: {} },
      response: response(),
    });

    expect(store.getSnapshot().entries[1]).toMatchObject({
      id: "b",
      baseId: "a",
      sentence: "더 조용하게",
    });
  });

  it("'이 지역에서 검색' 항목은 기준 요청의 문장을 그대로 쓴다", () => {
    const { store } = setup();
    store.addEntry({
      id: "a",
      kind: "new",
      request: { query: "역삼 카페" },
      response: response(),
    });

    store.addEntry({
      id: "b",
      kind: "region",
      baseId: "a",
      request: { query: "역삼 카페", mapBounds: BOUNDS },
      response: response(),
    });
    store.addEntry({
      id: "c",
      kind: "region",
      baseId: "b",
      request: { query: "역삼 카페", mapBounds: BOUNDS },
      response: response(),
    });

    expect(store.getSnapshot().entries.map(({ sentence }) => sentence)).toEqual(
      ["역삼 카페", "역삼 카페", "역삼 카페"],
    );
  });

  it("보는 결과가 바뀌면 선택을 비운다", () => {
    const { store } = setup();
    store.addEntry({
      id: "a",
      kind: "new",
      request: { query: "역삼 카페" },
      response: response(),
    });
    store.select(1);
    store.addEntry({
      id: "b",
      kind: "followUp",
      baseId: "a",
      request: { query: "더 조용하게" },
      response: response(),
    });
    expect(store.getSnapshot().selectedPlaceId).toBeUndefined();

    store.select(2);
    store.view("a");
    expect(store.getSnapshot()).toMatchObject({
      viewingId: "a",
      selectedPlaceId: undefined,
    });
  });

  it("다음 페이지의 카드를 기록해도 새 항목을 만들지 않고 선택을 유지한다", () => {
    const { store } = setup();
    store.addEntry({
      id: "a",
      kind: "new",
      request: { query: "역삼 카페" },
      response: response(),
    });
    store.select(1);

    store.recordCards([card(3)]);

    const state = store.getSnapshot();
    expect(state.entries).toHaveLength(1);
    expect(state.selectedPlaceId).toBe(1);
    expect(state.latestCards.get(3)).toEqual(card(3));
  });

  it("장소 id별로 가장 최근에 받은 카드를 둔다", () => {
    const { store } = setup();
    store.addEntry({
      id: "a",
      kind: "new",
      request: { query: "역삼 카페" },
      response: response(),
    });
    const newer = { ...card(1), score: 95 };

    store.addEntry({
      id: "b",
      kind: "followUp",
      baseId: "a",
      request: { query: "더 조용하게" },
      response: response({ items: [newer] }),
    });

    expect(store.getSnapshot().latestCards.get(1)).toEqual(newer);
    expect(store.getSnapshot().latestCards.get(2)).toEqual(card(2));
  });

  it("'새 검색'은 지금 보는 요청, 선택, 지역 고정을 비우고 기록은 남긴다", () => {
    const { store } = setup();
    store.addEntry({
      id: "a",
      kind: "new",
      request: { query: "역삼 카페" },
      response: response(),
    });
    store.select(1);
    store.lockRegion();

    store.startNewSearch();

    expect(store.getSnapshot()).toMatchObject({
      viewingId: undefined,
      selectedPlaceId: undefined,
      regionLocked: false,
    });
    expect(store.getSnapshot().entries).toHaveLength(1);
  });

  it("위치 결과를 두고, 바뀔 때마다 구독자에게 알린다", () => {
    const { store } = setup();
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.setLocation({ status: "ok", here: { lat: 37.5, lng: 127.03 } });

    expect(store.getSnapshot().location).toEqual({
      status: "ok",
      here: { lat: 37.5, lng: 127.03 },
    });
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
    store.select(1);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("바뀌지 않은 상태는 같은 스냅숏을 돌려준다", () => {
    const { store } = setup();
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });
});

describe("dominantCategory", () => {
  it("가장 많은 업종을 고른다", () => {
    expect(
      dominantCategory([card(1, "BAR"), card(2, "CAFE"), card(3, "BAR")]),
    ).toBe("BAR");
  });

  it("같으면 식당, 카페, 술집 순이다", () => {
    expect(dominantCategory([card(1, "BAR"), card(2, "CAFE")])).toBe("CAFE");
    expect(dominantCategory([card(1, "CAFE"), card(2, "RESTAURANT")])).toBe(
      "RESTAURANT",
    );
  });

  it("항목이 없으면 없다", () => {
    expect(dominantCategory([])).toBeUndefined();
  });
});

describe("formatClock", () => {
  it.each([
    [at(15, 5), "오후 3:05"],
    [at(12, 0), "오후 12:00"],
    [at(0, 30), "오전 12:30"],
    [at(9, 41), "오전 9:41"],
  ])("%d는 %s다", (ms, text) => {
    expect(formatClock(ms)).toBe(text);
  });
});

function entry(
  overrides: Partial<HistoryEntry> & { id: string },
): HistoryEntry {
  return {
    kind: "new",
    sentence: overrides.id,
    request: { query: overrides.id },
    conditions: {},
    totalCount: 20,
    category: "CAFE",
    at: at(15, 5),
    ...overrides,
  };
}

describe("historyMeta", () => {
  it("'<업종> <totalCount>곳 · 오후 h:mm'이다", () => {
    expect(historyMeta(entry({ id: "a", totalCount: 32 }))).toBe(
      "카페 32곳 · 오후 3:05",
    );
  });

  it("0건이면 '결과 0곳'이다", () => {
    expect(
      historyMeta(entry({ id: "a", totalCount: 0, category: undefined })),
    ).toBe("결과 0곳 · 오후 3:05");
  });
});

describe("continuedFrom", () => {
  const entries = [
    entry({ id: "a" }),
    entry({ id: "b", kind: "followUp", baseId: "a" }),
    entry({ id: "c", kind: "followUp", baseId: "a" }),
  ];

  it("기준 요청이 직전 요청이면 표시하지 않는다", () => {
    expect(continuedFrom(entries, entries[1])).toBeUndefined();
  });

  it("기준 요청이 직전 요청이 아니고 첫 번째 요청이면 '첫 요청에서 이어 검색'이다", () => {
    expect(continuedFrom(entries, entries[2])).toBe("첫 요청에서 이어 검색");
  });

  it("기준 요청이 직전 요청이 아니면 '<n>번째 요청에서 이어 검색'이다", () => {
    const longer = [
      ...entries,
      entry({ id: "d", kind: "followUp", baseId: "b" }),
    ];
    expect(continuedFrom(longer, longer[3])).toBe("2번째 요청에서 이어 검색");
  });

  it("새 검색은 표시하지 않는다", () => {
    expect(continuedFrom(entries, entries[0])).toBeUndefined();
  });
});

describe("followUpChips", () => {
  it("기준 요청을 따라 새 검색까지 거슬러 만난 후속 입력을 오래된 순서로 보여 준다", () => {
    const entries = [
      entry({ id: "A" }),
      entry({ id: "B", kind: "followUp", baseId: "A" }),
      entry({ id: "C", kind: "followUp", baseId: "B" }),
      entry({ id: "D", kind: "followUp", baseId: "A" }),
    ];

    expect(followUpChips(entries, "C")).toEqual(["B", "C"]);
    // 갈라진 다른 후속(D)은 넣지 않는다
    expect(followUpChips(entries, "D")).toEqual(["D"]);
    expect(followUpChips(entries, "A")).toEqual([]);
  });

  it("'이 지역에서 검색' 항목은 칩이 아니지만 사슬은 이어진다", () => {
    const entries = [
      entry({ id: "A" }),
      entry({ id: "B", kind: "followUp", baseId: "A" }),
      entry({ id: "R", kind: "region", baseId: "B" }),
      entry({ id: "C", kind: "followUp", baseId: "R" }),
    ];

    expect(followUpChips(entries, "C")).toEqual(["B", "C"]);
  });

  it("새 검색 뒤에는 칩이 없다", () => {
    const entries = [
      entry({ id: "A" }),
      entry({ id: "B", kind: "followUp", baseId: "A" }),
      entry({ id: "N" }),
    ];

    expect(followUpChips(entries, "N")).toEqual([]);
    expect(followUpChips(entries, undefined)).toEqual([]);
  });
});
