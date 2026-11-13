// @vitest-environment jsdom
import { QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { useEffect, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "@/shared/api/query-client";
import type { RuntimeConfig } from "@/shared/lib/runtime-config";
import { ToastProvider } from "@/shared/ui/overlay/toast";

import {
  BookmarkAccountChanged,
  type BookmarkAccess,
  type BookmarkItem,
  type BookmarkSession,
} from "../model/bookmark";
import type { PlaceSearchResponse } from "../model/place-types";
import { createSearchStore, type SearchStore } from "../model/search-store";
import { savedViewState } from "./saved-view-state";
import { SearchScreen } from "./search-screen";
import { BOUNDS, stubNaverMaps } from "./testing/naver-maps-stub";

const stores = vi.hoisted(() => ({
  current: undefined as unknown as SearchStore,
}));
vi.mock("../model/search-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../model/search-store")>();
  return {
    ...actual,
    searchStore: new Proxy({} as SearchStore, {
      get: (_, key: keyof SearchStore) => stores.current[key],
    }),
  };
});

// 주소 막대 흉내. "/"의 쿼리만 화면에 보이고, 다른 경로로 가면 기록만 남긴다
const nav = vi.hoisted(() => ({
  search: "",
  stack: [] as string[],
  listeners: new Set<() => void>(),
}));
function setSearch(url: string) {
  nav.search = new URL(url, "http://localhost").search;
  nav.listeners.forEach((listener) => listener());
}
const router = {
  push: vi.fn((url: string) => {
    nav.stack.push(nav.search);
    if (url.startsWith("/?") || url === "/") setSearch(url);
  }),
  replace: vi.fn((url: string) => setSearch(url)),
  back: vi.fn(() => setSearch(`/${nav.stack.pop() ?? ""}`)),
};
vi.mock("next/navigation", async () => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: () => void) => {
    nav.listeners.add(listener);
    return () => nav.listeners.delete(listener);
  };
  return {
    useRouter: () => router,
    useSearchParams: () =>
      new URLSearchParams(useSyncExternalStore(subscribe, () => nav.search)),
  };
});

const config = vi.hoisted(() => ({
  value: undefined as RuntimeConfig | undefined,
}));
vi.mock("@/shared/lib/runtime-config", () => ({
  loadRuntimeConfig: async () => config.value,
}));

function item(
  id: number,
  overrides: Partial<BookmarkItem> & {
    categoryGroup?: BookmarkItem["place"]["categoryGroup"];
  } = {},
): BookmarkItem {
  const { categoryGroup = "CAFE", ...rest } = overrides;
  return {
    place: {
      id,
      name: `저장 장소 ${id}`,
      categoryGroup,
      station: "YEOKSAM",
      lat: 37.5006,
      lng: 127.0364,
    },
    address: `역삼로 ${id}`,
    tags: ["조용한 곳", "넓은 곳", "세 번째 태그"],
    openStatus: "OPEN",
    savedAt: "2026-10-29T12:00:00+09:00",
    ...rest,
  };
}

// 목록 응답 줄. 함수면 요청마다 부른다
type Reply = () => Response | Promise<Response>;
let listReplies: Reply[];
let listCalls: string[];
// 해제(DELETE) 요청의 경로. 응답은 removeReply가 정한다
let removeCalls: string[];
let removeReply: Reply;
let searchCalls: number;
let pendingSearch: ((response: Response) => void) | undefined;

const list = (items: BookmarkItem[]) => () => Response.json(items);
const status = (code: number) => () =>
  Response.json({ status: code }, { status: code });

const nearby: PlaceSearchResponse = {
  conditions: {},
  nearby: true,
  totalCount: 1,
  items: [
    {
      place: {
        id: 99,
        name: "주변 추천 장소",
        categoryGroup: "CAFE",
        station: "YEOKSAM",
        lat: 37.5006,
        lng: 127.0364,
      },
      score: 90,
      labels: [],
      openStatus: "OPEN",
      reasons: [],
      scoreItems: [],
    },
  ],
};

beforeEach(() => {
  stores.current = createSearchStore();
  savedViewState.clear();
  nav.search = "";
  nav.stack = [];
  router.push.mockClear();
  router.replace.mockClear();
  router.back.mockClear();
  config.value = undefined;
  listReplies = [];
  listCalls = [];
  removeCalls = [];
  removeReply = () => new Response(null, { status: 204 });
  searchCalls = 0;
  pendingSearch = undefined;
  localStorage.clear();
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (init?.method === "DELETE") {
        removeCalls.push(url);
        return removeReply();
      }
      if (url === "/api/v1/me/bookmarks") {
        listCalls.push(new Headers(init?.headers).get("Authorization") ?? "");
        const next = listReplies.shift();
        if (!next) throw new Error("예상하지 못한 목록 요청");
        return next();
      }
      if (url === "/api/v1/places/nearby") return Response.json(nearby);
      if (url === "/api/v1/places/search") {
        searchCalls += 1;
        return new Promise<Response>((resolve) => (pendingSearch = resolve));
      }
      return Response.json([]);
    }),
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});

// jsdom에는 scrollIntoView가 없다. 바꿔 끼운 test가 있어도 다음 test는 원래 값으로 시작한다
const originalScrollIntoView = Element.prototype.scrollIntoView;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  Element.prototype.scrollIntoView = originalScrollIntoView;
});

// app의 useBookmarkAccess 대역
const harness = {
  setSession: (() => {}) as (session: BookmarkSession) => void,
  current: undefined as string | undefined,
  endSession: vi.fn(),
  login: vi.fn(),
};

function Harness({ initial }: { initial: BookmarkSession }) {
  const [session, setSession] = useState(initial);
  useEffect(() => {
    harness.setSession = (next) => {
      harness.current = next.status === "user" ? next.userId : undefined;
      setSession(next);
    };
  }, []);
  const access: BookmarkAccess = {
    session,
    currentUserId: () => harness.current,
    async send(userId, request) {
      if (harness.current !== userId) throw new BookmarkAccountChanged();
      return request();
    },
    endSession: () => {
      harness.endSession();
      harness.setSession({ status: "guest" });
    },
    login: harness.login,
  };
  return <SearchScreen bookmarks={access} />;
}

const USER: BookmarkSession = { status: "user", userId: "a" };

function renderScreen(
  url = "/",
  initial: BookmarkSession = USER,
  client = createQueryClient(),
) {
  setSearch(url);
  harness.current = initial.status === "user" ? initial.userId : undefined;
  harness.endSession.mockReset();
  harness.login.mockReset();
  return render(
    <QueryClientProvider client={client}>
      <ToastProvider>
        <Harness initial={initial} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

const savedPanel = () => screen.findByRole("region", { name: "저장한 장소" });
const savedList = () => screen.findByRole("list", { name: "저장한 장소" });
// 카드마다 ⋯ 메뉴 버튼이 따로 있어 상세를 여는 카드 버튼만 고른다
const cards = (listElement: HTMLElement) =>
  within(listElement)
    .getAllByRole("button")
    .filter((button) => !button.hasAttribute("aria-label"));
const cardNames = (listElement: HTMLElement) =>
  cards(listElement).map(
    (card) => card.querySelector(".text-title-md")?.textContent,
  );

describe("저장한 장소 화면 들어가기", () => {
  it("로그인한 사용자가 메인 버튼을 누르면 ?view=saved로 기록을 쌓고 저장한 장소만 보인다", async () => {
    listReplies.push(list([item(3), item(5)]));
    renderScreen();
    // 지도 키가 없어 홈은 주변 카드 대신 지도 실패 안내다(spec 75번). 홈이 그려지면 누른다
    fireEvent.click(await screen.findByRole("button", { name: "저장한 장소" }));

    expect(router.push).toHaveBeenCalledWith("/?view=saved");
    expect(cardNames(await savedList())).toEqual([
      "저장 장소 3",
      "저장 장소 5",
    ]);
    expect(listCalls).toEqual([""]);
    // 검색창, 오른쪽 위 버튼, 주변 추천은 보이지 않는다
    expect(screen.queryByRole("textbox", { name: "장소 검색" })).toBeNull();
    expect(screen.queryByRole("button", { name: "저장한 장소" })).toBeNull();
    expect(screen.queryByRole("button", { name: "내 정보" })).toBeNull();
    expect(screen.queryByText("주변 추천 장소")).toBeNull();
    expect(screen.getByRole("button", { name: "뒤로" })).toBeTruthy();
  });

  it("주소로 직접 들어와도 같은 화면이고 핏 점수와 정렬 선택이 없다", async () => {
    listReplies.push(list([item(3)]));
    renderScreen("/?view=saved");

    const panel = await savedPanel();
    await savedList();
    expect(within(panel).getByRole("heading").textContent).toBe("저장한 장소1");
    expect(screen.queryByText(/핏 점수|최신순/)).toBeNull();
  });

  it("지도 핀은 순위 없는 북마크 모양이고 저장한 장소만 있다", async () => {
    config.value = { env: "dev", naverMapClientId: "key" };
    const markers: { content: string }[] = [];
    vi.stubGlobal("naver", {
      maps: {
        Map: class {
          getBounds = () => ({});
          panTo() {}
          setSize() {}
          destroy() {}
        },
        LatLng: class {},
        Size: class {},
        Point: class {},
        Marker: class {
          constructor(options: { icon: { content: string } }) {
            markers.push(options.icon);
          }
          setMap() {}
          setIcon() {}
          setZIndex() {}
        },
        Event: { addListener: () => ({}), removeListener() {} },
      },
    });
    listReplies.push(list([item(3), item(5)]));
    renderScreen("/?view=saved");
    await savedList();

    await waitFor(() =>
      expect(
        markers.filter(({ content }) => content.includes("<svg")),
      ).toHaveLength(2),
    );
    expect(markers.some(({ content }) => />\d+</.test(content))).toBe(false);
  });

  it("진행 중이던 검색은 뒤에서 끝나도 저장한 장소 화면을 바꾸지 않고, 돌아가면 그 결과가 보인다", async () => {
    listReplies.push(list([item(3)]));
    renderScreen();
    fireEvent.change(screen.getByRole("textbox", { name: "장소 검색" }), {
      target: { value: "역삼 카페" },
    });
    fireEvent.submit(screen.getByRole("search"));
    await waitFor(() => expect(searchCalls).toBe(1));
    fireEvent.click(screen.getByRole("button", { name: "저장한 장소" }));
    await savedList();

    await act(async () =>
      pendingSearch?.(
        Response.json({
          ...nearby,
          nearby: false,
          items: [
            {
              ...nearby.items[0],
              place: { ...nearby.items[0].place, name: "검색 결과 장소" },
            },
          ],
        }),
      ),
    );
    expect(await savedList()).toBeTruthy();
    expect(screen.queryByText("검색 결과 장소")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "뒤로" }));
    expect(router.back).toHaveBeenCalled();
    expect(await screen.findByText("검색 결과 장소")).toBeTruthy();
  });

  it.each([
    [false, "smooth"],
    [true, "auto"],
  ])(
    "핀을 누르면 그 카드를 가리키되 메인 화면의 선택은 바꾸지 않는다(움직임 줄이기 %s → %s 스크롤)",
    async (reduce, behavior) => {
      vi.stubGlobal("matchMedia", () => ({
        matches: reduce,
        addEventListener() {},
        removeEventListener() {},
      }));
      config.value = { env: "dev", naverMapClientId: "key" };
      const clicks = new Map<unknown, () => void>();
      const markerOf = new Map<unknown, number>();
      vi.stubGlobal("naver", {
        maps: {
          Map: class {
            getBounds = () => ({});
            panTo() {}
            setSize() {}
            destroy() {}
          },
          LatLng: class {},
          Size: class {},
          Point: class {},
          Marker: class {
            constructor() {
              markerOf.set(this, markerOf.size);
            }
            setMap() {}
            setIcon() {}
            setZIndex() {}
          },
          Event: {
            addListener: (
              target: unknown,
              name: string,
              listener: () => void,
            ) => {
              if (name === "click") clicks.set(target, listener);
              return {};
            },
            removeListener() {},
          },
        },
      });
      Element.prototype.scrollIntoView = vi.fn();
      stores.current.select(42);
      listReplies.push(list([item(3), item(5)]));
      renderScreen("/?view=saved");
      await savedList();
      await waitFor(() => expect(clicks.size).toBe(2));

      act(() => [...clicks.values()][1]());

      expect(document.getElementById("saved-card-5")?.className).toContain(
        "bg-primary-soft",
      );
      expect(stores.current.getSnapshot().selectedPlaceId).toBe(42);
      expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith({
        block: "nearest",
        behavior,
      });
    },
  );
});

describe("[뒤로]", () => {
  it("메인에서 들어왔으면 브라우저 뒤로 가기로 들어오기 전 화면과 패널 상태로 돌아간다", async () => {
    listReplies.push(list([item(3)]));
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "저장한 장소" }));
    await savedList();

    fireEvent.click(screen.getByRole("button", { name: "뒤로" }));

    expect(router.back).toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
    expect(
      await screen.findByRole("textbox", { name: "장소 검색" }),
    ).toBeTruthy();
    // 저장한 장소 화면을 연 것은 요청 기록과 최근 검색에 남지 않는다
    expect(stores.current.getSnapshot().entries).toHaveLength(0);
    expect(localStorage.length).toBe(0);
  });

  it("앱 안에서 들어온 것이 아니면 메인 기본 화면으로 replace한다", async () => {
    listReplies.push(list([item(3)]));
    renderScreen("/?view=saved");
    await savedList();

    fireEvent.click(screen.getByRole("button", { name: "뒤로" }));

    expect(router.replace).toHaveBeenCalledWith("/");
    expect(router.back).not.toHaveBeenCalled();
  });

  it("상세에 다녀와 다시 그려져도, 메인에서 들어온 것을 기억해 뒤로 가기이고 메인 패널 상태를 되살린다", async () => {
    listReplies.push(list([item(3)]), list([item(3)]));
    savedViewState.enter({ from: "main", mainPanel: "history" });
    const first = renderScreen("/?view=saved");
    await savedList();
    first.unmount();

    renderScreen("/?view=saved");
    await savedList();
    fireEvent.click(screen.getByRole("button", { name: "뒤로" }));

    expect(router.back).toHaveBeenCalled();
  });
});

describe("목록 받기", () => {
  it("들어올 때마다 새로 받고, 받는 동안 이전 목록 없이 로딩을 보인다", async () => {
    let second!: (response: Response) => void;
    listReplies.push(
      list([item(3)]),
      () => new Promise<Response>((resolve) => (second = resolve)),
    );
    renderScreen();
    fireEvent.click(screen.getByRole("button", { name: "저장한 장소" }));
    await savedList();
    fireEvent.click(screen.getByRole("button", { name: "뒤로" }));
    await screen.findByRole("textbox", { name: "장소 검색" });

    fireEvent.click(screen.getByRole("button", { name: "저장한 장소" }));

    expect(await screen.findByText("저장한 장소를 불러오는 중")).toBeTruthy();
    expect(screen.queryByText("저장 장소 3")).toBeNull();
    await act(async () => second(Response.json([item(7)])));
    expect(cardNames(await savedList())).toEqual(["저장 장소 7"]);
    expect(listCalls).toHaveLength(2);
  });

  it("카드는 이름, 업종, '영업 상태 · 거리 · 주소', 태그 앞 2개를 보이고 누르면 from=saved로 상세를 연다", async () => {
    stores.current.setLocation({
      status: "ok",
      here: { lat: 37.5006, lng: 127.0364 },
    } as never);
    listReplies.push(list([item(3)]));
    renderScreen("/?view=saved");

    const [card] = cards(await savedList());
    expect(card.textContent).toContain("저장 장소 3");
    expect(card.textContent).toContain("카페");
    expect(card.textContent).toContain("영업 중 · 0m · 역삼로 3");
    expect(within(card).getByText("조용한 곳")).toBeTruthy();
    expect(within(card).getByText("넓은 곳")).toBeTruthy();
    expect(within(card).queryByText("세 번째 태그")).toBeNull();

    fireEvent.click(card);
    expect(router.push).toHaveBeenCalledWith("/places/3?from=saved");
  });

  it("영업 상태 UNKNOWN, 위치 없음, 주소 없음, 태그 없음이면 그 값과 구분자를 뺀다", async () => {
    listReplies.push(
      list([
        item(3, { openStatus: "UNKNOWN", address: undefined, tags: [] }),
        item(4, { address: undefined }),
      ]),
    );
    renderScreen("/?view=saved");

    const [unknown, open] = cards(await savedList());
    expect(unknown.querySelector("p")).toBeNull();
    expect(unknown.querySelectorAll("li, span.rounded-full").length).toBe(0);
    expect(open.querySelector("p")?.textContent).toBe("영업 중");
  });
});

describe("업종 탭", () => {
  const mixed = [
    item(1, { categoryGroup: "RESTAURANT" }),
    item(2, { categoryGroup: "CAFE" }),
    item(3, { categoryGroup: "CAFE" }),
  ];

  it("[전체·식당·카페·술집]이 보이고, 고르면 기록 없이 주소가 바뀌며 목록과 개수가 그 업종만 남는다", async () => {
    listReplies.push(list(mixed));
    renderScreen("/?view=saved");
    await savedList();

    const tabs = screen.getAllByRole("tab").map((tab) => tab.textContent);
    expect(tabs).toEqual(["전체", "식당", "카페", "술집"]);
    fireEvent.click(screen.getByRole("tab", { name: "카페" }));

    expect(router.replace).toHaveBeenCalledWith(
      "/?view=saved&category=CAFE",
      expect.anything(),
    );
    expect(cardNames(await savedList())).toEqual([
      "저장 장소 2",
      "저장 장소 3",
    ]);
    expect(screen.getByRole("heading", { name: "저장한 장소2" })).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "카페" }).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it.each([
    ["BAR", "저장한 술집이 없어요"],
    ["RESTAURANT", "저장한 식당이 없어요"],
  ])(
    "category=%s에 저장한 장소가 없으면 '%s'만 보인다",
    async (category, text) => {
      listReplies.push(list([item(2, { categoryGroup: "CAFE" })]));
      renderScreen(`/?view=saved&category=${category}`);

      expect(await screen.findByText(text)).toBeTruthy();
      expect(
        screen.queryByRole("button", { name: "추천 받으러 가기" }),
      ).toBeNull();
      expect(screen.getAllByRole("tab")).toHaveLength(4);
    },
  );

  it("카페 탭에 없으면 '저장한 카페가 없어요'다", async () => {
    listReplies.push(list([item(1, { categoryGroup: "RESTAURANT" })]));
    renderScreen("/?view=saved&category=CAFE");

    expect(await screen.findByText("저장한 카페가 없어요")).toBeTruthy();
  });
});

describe("빈 상태와 실패", () => {
  it("0개면 제목만 두고 안내와 [추천 받으러 가기]를 보이며, 누르면 검색 결과를 닫고 메인 기본 화면으로 replace한다", async () => {
    listReplies.push(list([]));
    renderScreen("/?view=saved");

    expect(await screen.findByText("아직 저장한 장소가 없어요")).toBeTruthy();
    expect(
      screen.getByText("장소 상세에서 저장 버튼을 누르면 여기에 모여요."),
    ).toBeTruthy();
    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.getByRole("heading", { name: "저장한 장소" })).toBeTruthy();
    const startOver = vi.spyOn(stores.current, "startNewSearch");

    fireEvent.click(screen.getByRole("button", { name: "추천 받으러 가기" }));

    expect(startOver).toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith("/");
  });

  it.each([
    ["서버 오류", status(500)],
    ["엔진 없음", status(503)],
    ["401이 아닌 4xx", status(404)],
    ["시간 초과", () => Promise.reject(new DOMException("t", "TimeoutError"))],
  ])(
    "%s면 패널 자리에 불러오기 실패를 보이고 [다시 시도]가 다시 받는다",
    async (_, failure) => {
      listReplies.push(failure, list([item(3)]));
      renderScreen("/?view=saved");

      expect(
        await screen.findByText("저장한 장소를 불러오지 못했어요"),
      ).toBeTruthy();
      expect(screen.getByText("잠시 후 다시 시도해 주세요.")).toBeTruthy();
      expect(screen.queryByText("아직 저장한 장소가 없어요")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

      expect(cardNames(await savedList())).toEqual(["저장 장소 3"]);
      expect(listCalls).toHaveLength(2);
    },
  );

  it("연결 실패면 지도 없이 전체 페이지로 연결 안내를 보이고 [다시 시도]가 다시 받는다", async () => {
    listReplies.push(
      () => Promise.reject(new TypeError("Failed to fetch")),
      list([item(3)]),
    );
    renderScreen("/?view=saved");

    expect(
      await screen.findByText("인터넷에 연결되어 있지 않아요"),
    ).toBeTruthy();
    expect(
      screen.getByText("연결을 확인하고 다시 시도해 주세요."),
    ).toBeTruthy();
    expect(screen.getByRole("heading", { name: "저장한 장소" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "뒤로" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

    expect(cardNames(await savedList())).toEqual(["저장 장소 3"]);
  });
});

describe("비로그인과 세션 종료", () => {
  it("비로그인 사용자가 메인 버튼을 누르면 목록을 받지 않고 로그인 안내를 띄우며, [로그인]은 저장한 장소 화면으로 돌아오게 남긴다", async () => {
    renderScreen("/", { status: "guest" });

    fireEvent.click(screen.getByRole("button", { name: "저장한 장소" }));
    const dialog = await screen.findByRole("alertdialog");
    expect(
      within(dialog).getByText("저장한 장소는 로그인해야 볼 수 있어요."),
    ).toBeTruthy();
    // 북마크 기능 전에는 '준비 중이에요'를 띄웠다(AC-28)
    expect(screen.queryByText("준비 중이에요")).toBeNull();
    fireEvent.click(within(dialog).getByRole("button", { name: "로그인" }));

    expect(harness.login).toHaveBeenCalledWith("/?view=saved");
    expect(router.push).not.toHaveBeenCalled();
    expect(listCalls).toHaveLength(0);
  });

  it("메인 버튼의 [취소]는 창만 닫고 메인에 남는다", async () => {
    renderScreen("/", { status: "guest" });

    fireEvent.click(screen.getByRole("button", { name: "저장한 장소" }));
    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "취소",
      }),
    );

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(router.push).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });

  it("비로그인으로 저장한 장소 화면에 들어오면 안내 창 뒤에 지도와 제목만 있는 패널이고, [로그인]은 고른 탭을 담아 남긴다", async () => {
    renderScreen("/?view=saved&category=CAFE", { status: "guest" });

    const dialog = await screen.findByRole("alertdialog");
    expect(listCalls).toHaveLength(0);
    expect(screen.queryAllByRole("tab", { hidden: true })).toHaveLength(0);
    fireEvent.click(within(dialog).getByRole("button", { name: "로그인" }));

    expect(harness.login).toHaveBeenCalledWith("/?view=saved&category=CAFE");
  });

  it("저장한 장소 화면에서 뜬 창의 [취소]는 그 화면의 [뒤로]와 같다", async () => {
    renderScreen("/?view=saved", { status: "guest" });

    fireEvent.click(
      within(await screen.findByRole("alertdialog")).getByRole("button", {
        name: "취소",
      }),
    );

    expect(router.replace).toHaveBeenCalledWith("/");
  });

  it("목록 요청이 401로 끝나면 세션을 지우고 로그인 안내를 띄운다", async () => {
    listReplies.push(status(401));
    renderScreen("/?view=saved");

    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(harness.endSession).toHaveBeenCalled();
    expect(screen.queryByText("저장한 장소를 불러오지 못했어요")).toBeNull();
  });

  it("로그인 복원 중이면 로딩을 보이고, 복원되면 목록을 받는다", async () => {
    listReplies.push(list([item(3)]));
    renderScreen("/?view=saved", { status: "checking" });

    expect(await screen.findByText("저장한 장소를 불러오는 중")).toBeTruthy();
    expect(listCalls).toHaveLength(0);
    act(() => harness.setSession(USER));

    expect(cardNames(await savedList())).toEqual(["저장 장소 3"]);
  });

  it("다른 계정으로 바뀌면 이전 계정의 목록을 보이지 않고 새 계정으로 받는다", async () => {
    listReplies.push(list([item(3)]), list([item(8)]));
    renderScreen("/?view=saved");
    await savedList();

    act(() => harness.setSession({ status: "user", userId: "b" }));

    expect(cardNames(await savedList())).toEqual(["저장 장소 8"]);
    expect(listCalls).toEqual(["", ""]);
  });
});

describe("상세에서 돌아오기", () => {
  it("다시 그려지면 고른 탭과 패널 높이가 그대로이고 해제한 장소는 빠져 있다", async () => {
    listReplies.push(list([item(2), item(3)]), list([item(3)]));
    savedViewState.enter({ from: "main", mainPanel: "middle" });
    const first = renderScreen("/?view=saved&category=CAFE");
    await savedList();
    fireEvent.click(screen.getByRole("button", { name: "패널 펼치기" }));
    expect(screen.getByRole("button", { name: "지도 보기" })).toBeTruthy();
    first.unmount();

    renderScreen("/?view=saved&category=CAFE");

    expect(cardNames(await savedList())).toEqual(["저장 장소 3"]);
    expect(screen.getByRole("button", { name: "지도 보기" })).toBeTruthy();
    expect(
      screen.getByRole("tab", { name: "카페" }).getAttribute("aria-selected"),
    ).toBe("true");
  });
});

describe("목록에서 해제(D-18)", () => {
  async function removeFromMenu(name: string) {
    fireEvent.click(
      await screen.findByRole("button", { name: `${name} 메뉴` }),
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "해제" }));
  }

  it("⋯ 메뉴의 [해제]는 확인 없이 바로 해제하고, 목록을 다시 받지 않고 그 카드와 개수만 줄인다", async () => {
    listReplies.push(list([item(2), item(3)]));
    renderScreen("/?view=saved");
    await savedList();

    await removeFromMenu("저장 장소 2");

    expect(await screen.findByText("저장을 해제했어요")).toBeTruthy();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(removeCalls).toEqual(["/api/v1/me/bookmarks/2"]);
    expect(cardNames(await savedList())).toEqual(["저장 장소 3"]);
    expect(screen.getByRole("heading", { name: "저장한 장소1" })).toBeTruthy();
    expect(listCalls).toHaveLength(1);
  });

  it("마지막 장소를 해제하면 빈 상태를 보인다", async () => {
    listReplies.push(list([item(3)]));
    renderScreen("/?view=saved");
    await savedList();

    await removeFromMenu("저장 장소 3");

    expect(await screen.findByText("아직 저장한 장소가 없어요")).toBeTruthy();
  });

  it("해제하지 못하면 카드를 남기고 알린다", async () => {
    removeReply = status(500);
    listReplies.push(list([item(3)]));
    renderScreen("/?view=saved");
    await savedList();

    await removeFromMenu("저장 장소 3");

    expect(
      await screen.findByText("저장을 해제하지 못했어요. 다시 시도해 주세요."),
    ).toBeTruthy();
    expect(cardNames(await savedList())).toEqual(["저장 장소 3"]);
  });

  it("해제 요청이 401로 끝나면 세션을 지우고 로그인 안내를 띄운다", async () => {
    removeReply = status(401);
    listReplies.push(list([item(3)]));
    renderScreen("/?view=saved");
    await savedList();

    await removeFromMenu("저장 장소 3");

    expect(await screen.findByRole("alertdialog")).toBeTruthy();
    expect(harness.endSession).toHaveBeenCalled();
  });
});

describe("저장한 장소 화면과 홈 주변 카드 (S15P31A302-204)", () => {
  const AREA_B = { swLat: 37.52, swLng: 127.06, neLat: 37.53, neLng: 127.08 };
  let map: ReturnType<typeof stubNaverMaps>;
  // 홈 주변 카드 요청 본문
  let nearbyBodies: unknown[];

  beforeEach(() => {
    config.value = { env: "dev", naverMapClientId: "key" };
    map = stubNaverMaps();
    nearbyBodies = [];
    const original = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>((input, init) => {
        if (String(input) === "/api/v1/places/nearby") {
          nearbyBodies.push(JSON.parse(String(init?.body)));
        }
        return original(input, init);
      }),
    );
  });

  const homeCards = () =>
    screen.findByRole("region", { name: "주변 추천 장소" });

  it("앱을 저장한 장소 화면으로 열면 그동안은 받지 않고, 홈이 처음 보일 때 한 번 받는다 (AC-64)", async () => {
    listReplies.push(list([item(3)]));
    renderScreen("/?view=saved");
    await savedList();
    await waitFor(() =>
      expect(document.querySelector('[data-map-state="ready"]')).toBeTruthy(),
    );
    await act(async () => {});
    expect(nearbyBodies).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "뒤로" }));

    await homeCards();
    await act(async () => {});
    expect(nearbyBodies).toEqual([{ mapBounds: BOUNDS }]);
  });

  it("저장한 장소 화면에서 지도를 끈 뒤 홈으로 오면 홈 진입이라 끈 화면의 영역으로 한 번 받는다 (AC-67)", async () => {
    listReplies.push(list([item(3)]));
    renderScreen();
    await homeCards();
    fireEvent.click(screen.getByRole("button", { name: "저장한 장소" }));
    await savedList();

    map.fire("dragend");
    map.view.bounds = AREA_B;
    map.fire("idle");
    fireEvent.click(screen.getByRole("button", { name: "뒤로" }));

    await waitFor(() => expect(nearbyBodies).toHaveLength(2));
    expect(nearbyBodies).toEqual([
      { mapBounds: BOUNDS },
      { mapBounds: AREA_B },
    ]);
  });

  it("결과를 보다가 저장한 장소 화면에 다녀오면 결과 화면으로 돌아가 nearby 요청이 없다 (AC-67)", async () => {
    listReplies.push(list([item(3)]));
    renderScreen();
    await homeCards();
    fireEvent.change(screen.getByRole("textbox", { name: "장소 검색" }), {
      target: { value: "역삼 카페" },
    });
    fireEvent.submit(screen.getByRole("search"));
    await waitFor(() => expect(searchCalls).toBe(1));
    await act(async () =>
      pendingSearch?.(Response.json({ ...nearby, nearby: false })),
    );
    await screen.findByRole("list", { name: "추천 장소" });
    fireEvent.click(screen.getByRole("button", { name: "저장한 장소" }));
    await savedList();

    fireEvent.click(screen.getByRole("button", { name: "뒤로" }));

    expect(await screen.findByRole("list", { name: "추천 장소" })).toBeTruthy();
    await act(async () => {});
    expect(nearbyBodies).toHaveLength(1);
  });

  it("결과를 보다가 저장한 장소 화면에서 지도를 끌고 돌아와도 '이 지역에서 검색'이 없고, 결과 화면에서 끌면 나타난다 (spec 39번)", async () => {
    listReplies.push(list([item(3)]));
    renderScreen();
    await homeCards();
    fireEvent.change(screen.getByRole("textbox", { name: "장소 검색" }), {
      target: { value: "역삼 카페" },
    });
    fireEvent.submit(screen.getByRole("search"));
    await waitFor(() => expect(searchCalls).toBe(1));
    await act(async () =>
      pendingSearch?.(Response.json({ ...nearby, nearby: false })),
    );
    await screen.findByRole("list", { name: "추천 장소" });
    // 결과 맞춤 이동이 멈춘 뒤의 화면이다
    map.fire("idle");
    fireEvent.click(screen.getByRole("button", { name: "저장한 장소" }));
    await savedList();

    map.fire("dragend");
    map.fire("idle");
    fireEvent.click(screen.getByRole("button", { name: "뒤로" }));

    await screen.findByRole("list", { name: "추천 장소" });
    expect(
      screen.queryByRole("button", { name: "이 지역에서 검색" }),
    ).toBeNull();

    map.fire("dragend");

    expect(
      screen.getByRole("button", { name: "이 지역에서 검색" }),
    ).toBeTruthy();
  });
});
