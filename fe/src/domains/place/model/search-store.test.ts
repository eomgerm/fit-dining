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
  requestTitle,
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

  it("첫 새 검색이 thread를 열고, 그 뒤의 요청은 같은 thread에 쌓인다", () => {
    const { store } = setup();
    store.addEntry({
      id: "a",
      kind: "new",
      request: { query: "역삼 카페" },
      response: response(),
    });
    const { threadId } = store.getSnapshot();
    store.addEntry({
      id: "b",
      kind: "followUp",
      baseId: "a",
      request: { query: "더 조용하게", previousConditions: {} },
      response: response(),
    });

    expect(threadId).toMatch(/^thread-/);
    expect(store.getSnapshot().threadId).toBe(threadId);
    expect(store.getSnapshot().entries.map(({ id }) => id)).toEqual(["a", "b"]);
  });

  it("'새 검색'은 지금 thread를 닫아 기록, 보는 요청, 선택을 비우고 다음 새 검색은 새 thread를 연다", () => {
    const { store } = setup();
    store.addEntry({
      id: "a",
      kind: "new",
      request: { query: "역삼 카페" },
      response: response(),
    });
    const first = store.getSnapshot().threadId;
    store.select(1);

    store.startNewSearch();

    expect(store.getSnapshot()).toMatchObject({
      threadId: undefined,
      entries: [],
      viewingId: undefined,
      selectedPlaceId: undefined,
    });
    expect(store.getSnapshot()).not.toHaveProperty("regionLocked");
    store.addEntry({
      id: "b",
      kind: "new",
      request: { query: "강남 술집" },
      response: response(),
    });
    expect(store.getSnapshot().threadId).not.toBe(first);
  });

  it("로그인 세션이 바뀌어 되돌리면 thread, 기록, 과거 결과, 선택, 최신 카드를 비우고 위치는 남긴다", () => {
    const { store } = setup();
    const here = { lat: 37.5, lng: 127.03 };
    store.setLocation({ status: "ok", here });
    store.finishInitialView();
    store.noticeLocation("denied");
    store.addEntry({
      id: "a",
      kind: "new",
      request: { query: "역삼 카페" },
      response: response(),
    });
    store.openPast("a");
    store.select(1);

    store.reset();

    expect(store.getSnapshot()).toMatchObject({
      threadId: undefined,
      entries: [],
      viewingId: undefined,
      pastId: undefined,
      selectedPlaceId: undefined,
      location: { status: "ok", here },
      initialView: "done",
      locationNotice: "denied",
      epoch: 1,
    });
    expect(store.getSnapshot().latestCards.size).toBe(0);
  });

  it("다시 연 thread는 그때 시각의 요청들을 기록으로 두고 마지막 요청을 지금 보는 요청으로 둔다", () => {
    const { store } = setup();

    store.openThread("thread-old", [
      {
        id: "a",
        kind: "new",
        at: 100,
        request: { query: "역삼 카페" },
        response: response(),
      },
      {
        id: "b",
        kind: "followUp",
        baseId: "a",
        at: 200,
        request: { query: "더 조용하게" },
        response: response(),
      },
    ]);

    expect(store.getSnapshot()).toMatchObject({
      threadId: "thread-old",
      viewingId: "b",
    });
    expect(
      store.getSnapshot().entries.map(({ sentence, at }) => [sentence, at]),
    ).toEqual([
      ["역삼 카페", 100],
      ["더 조용하게", 200],
    ]);
  });

  it("다시 연 thread의 기록은 저장값을 바꾸지 않고 실행 요청으로 바꾸며, 실행 불가 region 기록은 요청 없이 문장과 결과만 둔다(spec 67번)", () => {
    const { store } = setup();
    const legacy = {
      query: "강남역 파스타",
      previousConditions: { area: "강남역" },
      mapBounds: BOUNDS,
    };
    const broken = { query: "역삼 카페", previousConditions: {} };
    const turns = [
      {
        id: "a",
        kind: "new" as const,
        at: 100,
        request: { query: "강남역 파스타", mapBounds: BOUNDS },
        response: response({ conditions: { area: "강남역" } }),
      },
      {
        id: "b",
        kind: "region" as const,
        baseId: "a",
        at: 200,
        request: legacy,
        response: response({ conditions: { menu: "파스타" } }),
      },
      {
        id: "c",
        kind: "region" as const,
        baseId: "a",
        at: 300,
        request: broken,
        response: response({ conditions: {} }),
      },
    ];
    const saved = JSON.stringify(turns);

    store.openThread("thread-old", turns);

    const [a, b, c] = store.getSnapshot().entries;
    expect(a.request).toEqual({ query: "강남역 파스타", mapBounds: BOUNDS });
    expect(b.request).toEqual({
      query: "강남역 파스타",
      conditions: { menu: "파스타" },
      mapBounds: BOUNDS,
    });
    expect(c).toMatchObject({
      kind: "region",
      sentence: "역삼 카페",
      conditions: {},
    });
    expect(c.request).toBeUndefined();
    expect(JSON.stringify(turns)).toBe(saved);
  });

  it("과거 결과 화면은 지금 보는 요청을 바꾸지 않고, 새 요청이 쌓이면 닫힌다", () => {
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
      request: { query: "더 조용하게" },
      response: response(),
    });
    store.select(1);

    store.openPast("a");
    expect(store.getSnapshot()).toMatchObject({
      pastId: "a",
      viewingId: "b",
      selectedPlaceId: undefined,
    });

    store.addEntry({
      id: "c",
      kind: "new",
      request: { query: "역삼 카페" },
      response: response(),
    });
    expect(store.getSnapshot()).toMatchObject({
      pastId: undefined,
      viewingId: "c",
    });
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

  it("처음 이동은 pending에서 시작해 한 번만 applying이 되고, done 뒤에는 되돌아가지 않는다(spec 62번)", () => {
    const { store } = setup();
    expect(store.getSnapshot().initialView).toBe("pending");

    expect(store.startInitialView()).toBe(true);
    expect(store.getSnapshot().initialView).toBe("applying");
    // 다른 화면은 같은 이동을 다시 가져가지 않는다
    expect(store.startInitialView()).toBe(false);

    store.finishInitialView();
    expect(store.getSnapshot().initialView).toBe("done");
    expect(store.startInitialView()).toBe(false);
    expect(store.getSnapshot().initialView).toBe("done");
  });

  it("남은 처음 이동은 시작하지 않고도 끝낼 수 있다", () => {
    const { store } = setup();

    store.finishInitialView();

    expect(store.getSnapshot().initialView).toBe("done");
    expect(store.startInitialView()).toBe(false);
  });

  it('"내 위치"가 처음 이동을 가지면 처음 조회와 처음 panTo의 끝으로는 done이 되지 않고 버튼의 끝으로 done이 된다(spec 70번)', () => {
    const { store } = setup();
    expect(store.startInitialView()).toBe(true);

    store.takeInitialViewByButton();
    expect(store.getSnapshot().initialView).toBe("applying");
    store.finishInitialView("initial");
    expect(store.getSnapshot().initialView).toBe("applying");
    // 처음 이동을 다른 화면이 다시 가져가지 않는다
    expect(store.startInitialView()).toBe(false);

    store.finishInitialView("button");
    expect(store.getSnapshot()).toMatchObject({
      initialView: "done",
      initialEndedBy: "button",
    });
  });

  it.each(["user", "fit", "map"] as const)(
    "버튼이 가진 동안에도 %s로는 done이 된다(spec 70번)",
    (by) => {
      const { store } = setup();
      store.takeInitialViewByButton();

      store.finishInitialView(by);

      expect(store.getSnapshot()).toMatchObject({
        initialView: "done",
        initialEndedBy: by,
      });
    },
  );

  it("이미 done이면 버튼이 가져가도 그대로 done이다", () => {
    const { store } = setup();
    store.finishInitialView("user");

    store.takeInitialViewByButton();

    expect(store.getSnapshot()).toMatchObject({
      initialView: "done",
      initialEndedBy: "user",
    });
  });

  it("홈 진입마다 번호가 오르고 영역이 비며, 지금 진입의 영역만 확정한다(spec 72번, 73번)", () => {
    const { store } = setup();
    const area = { swLat: 37.49, swLng: 127.02, neLat: 37.51, neLng: 127.05 };
    const first = store.getSnapshot().home.entry;
    store.setHomeBounds(first, area);
    expect(store.getSnapshot().home).toEqual({ entry: first, bounds: area });

    store.beginHomeEntry();
    const second = store.getSnapshot().home.entry;
    expect(second).toBe(first + 1);
    expect(store.getSnapshot().home.bounds).toBeUndefined();

    // 지난 진입의 늦은 확정은 버린다
    store.setHomeBounds(first, area);
    expect(store.getSnapshot().home.bounds).toBeUndefined();
    store.setHomeBounds(second, area);
    expect(store.getSnapshot().home).toEqual({ entry: second, bounds: area });
  });

  it("로그인 세션이 바뀌면 홈 영역을 비우고 진입 번호를 올린다(spec 73번)", () => {
    const { store } = setup();
    const area = { swLat: 37.49, swLng: 127.02, neLat: 37.51, neLng: 127.05 };
    const entry = store.getSnapshot().home.entry;
    store.setHomeBounds(entry, area);

    store.reset();

    expect(store.getSnapshot().home.bounds).toBeUndefined();
    expect(store.getSnapshot().home.entry).toBe(entry + 1);
  });

  it("위치 알림은 한 번만 가져갈 수 있다(spec 63번)", () => {
    const { store } = setup();
    expect(store.takeLocationNotice()).toBeUndefined();

    store.noticeLocation("failed");

    expect(store.getSnapshot().locationNotice).toBe("failed");
    expect(store.takeLocationNotice()).toBe("failed");
    expect(store.takeLocationNotice()).toBeUndefined();
    expect(store.getSnapshot().locationNotice).toBeUndefined();
  });

  it("store마다 페이지 세션이 하나다", () => {
    expect(setup().store.pageSession).not.toBe(setup().store.pageSession);
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

describe("requestTitle", () => {
  it("기준 요청을 따라 거슬러 올라간 새 검색의 문장이다", () => {
    const entries = [
      entry({ id: "A" }),
      entry({ id: "B", kind: "followUp", baseId: "A" }),
      entry({ id: "R", kind: "region", baseId: "B" }),
      entry({ id: "C", kind: "followUp", baseId: "R" }),
      entry({ id: "N" }),
    ];

    expect(requestTitle(entries, "C")).toBe("A");
    expect(requestTitle(entries, "A")).toBe("A");
    expect(requestTitle(entries, "N")).toBe("N");
  });

  it("기록에 없는 요청이면 없다", () => {
    expect(requestTitle([entry({ id: "A" })], "X")).toBeUndefined();
    expect(requestTitle([entry({ id: "A" })], undefined)).toBeUndefined();
  });
});
