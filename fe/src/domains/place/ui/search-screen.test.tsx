// @vitest-environment jsdom
import {
  focusManager,
  onlineManager,
  type QueryClient,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { Activity } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "@/shared/api/query-client";
import type { RuntimeConfig } from "@/shared/lib/runtime-config";
import { ToastProvider } from "@/shared/ui/overlay/toast";

import type { BookmarkAccess } from "../model/bookmark";
import type { PlaceCard, PlaceSearchResponse } from "../model/place-types";
import { createSearchStore, type SearchStore } from "../model/search-store";
import { SearchScreen } from "./search-screen";
import { SEARCH_SLOW_MS, SEARCH_STEP_MS } from "./search-steps";
import { BOUNDS, stubNaverMaps } from "./testing/naver-maps-stub";

// 인증은 북마크 테스트(place-detail-bookmark, saved-places)가 본다. 여기서는 비로그인이다
const guest: BookmarkAccess = {
  session: { status: "guest" },
  currentUserId: () => undefined,
  send: () => Promise.reject(new Error("비로그인")),
  endSession: () => {},
  login: () => {},
};

// 화면이 쓰는 모듈 store를 테스트마다 새 store로 바꾼다
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

const push = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
  useSearchParams: () => new URLSearchParams(),
}));

const config = vi.hoisted(() => ({
  value: undefined as RuntimeConfig | undefined,
}));
vi.mock("@/shared/lib/runtime-config", () => ({
  loadRuntimeConfig: async () => config.value,
}));

function card(id: number): PlaceCard {
  return {
    place: {
      id,
      name: `장소 ${id}`,
      categoryGroup: "CAFE",
      station: "YEOKSAM",
      lat: 37.5,
      lng: 127.03,
    },
    score: 80 + id,
    labels: ["조용해요", "넓어요"],
    openStatus: "OPEN",
    reasons: [],
    scoreItems: [],
  };
}

// 사용자가 보낸 검색 요청 본문과 주소(같은 순서). 첫 화면 주변 카드 요청(/places/nearby)은 nearbyBodies에 따로 모은다
let searchBodies: Record<string, unknown>[];
let searchUrls: string[];
let nearbyBodies: Record<string, unknown>[];
// 켜면 그 응답에 X-Fallback: AI_UNAVAILABLE을 붙인다(BE가 AI 대신 키워드로 찾은 결과)
let aiFallback: { nearby: boolean; search: boolean };

const fallbackHeaders = (on: boolean) =>
  on ? { headers: { "X-Fallback": "AI_UNAVAILABLE" } } : undefined;

// 첫 요청은 conditions {area: "역삼"}, 후속 조건이면 changeSummary가 있다. "없는"이 들어가면 빈 결과다
function stubApi() {
  searchBodies = [];
  searchUrls = [];
  nearbyBodies = [];
  aiFallback = { nearby: false, search: false };
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.startsWith("/api/v1/places/suggest")) return Response.json([]);
      const body = JSON.parse(String(init?.body));
      const home = url === "/api/v1/places/nearby";
      if (home) nearbyBodies.push(body);
      else {
        searchBodies.push(body);
        searchUrls.push(url);
      }
      const followUp = body.previousConditions !== undefined;
      if (home || body.query.includes("근처")) {
        // 1번은 역삼역 바로 앞, 3번은 약 2km 떨어진 곳
        const far = { ...card(3), place: { ...card(3).place, lat: 37.518 } };
        return Response.json(
          {
            conditions: {},
            nearby: true,
            totalCount: 2,
            items: [card(1), far],
          } satisfies PlaceSearchResponse,
          fallbackHeaders(home ? aiFallback.nearby : aiFallback.search),
        );
      }
      if (body.query.includes("없는")) {
        return Response.json(
          {
            conditions: {},
            nearby: false,
            totalCount: 0,
            items: [],
            emptyReason: {
              cause: "찾지 못했어요",
              suggestion: "다시 찾아 보세요",
            },
          } satisfies PlaceSearchResponse,
          fallbackHeaders(aiFallback.search),
        );
      }
      const response: PlaceSearchResponse = {
        conditions: followUp
          ? { ...body.previousConditions, quiet: true }
          : { area: "역삼" },
        nearby: false,
        totalCount: 2,
        items: followUp ? [card(2)] : [card(1), card(2)],
        ...(followUp && { changeSummary: "요청하신 조건을 반영했어요" }),
      };
      return Response.json(response, fallbackHeaders(aiFallback.search));
    }),
  );
}

// 테스트가 만든 QueryClient. 화면을 내린 뒤 cache와 진행 중인 요청·재시도를 비워 다음 테스트에 닿지 않게 한다
const clients: QueryClient[] = [];
// 재시도 횟수는 제품 그대로 두고 재시도 사이 대기만 없앤다(재시도 정책은 query-client 테스트가 본다)
function newClient() {
  const client = createQueryClient();
  const defaults = client.getDefaultOptions();
  client.setDefaultOptions({
    ...defaults,
    queries: { ...defaults.queries, retryDelay: 0 },
  });
  clients.push(client);
  return client;
}

function renderScreen() {
  return render(
    <QueryClientProvider client={newClient()}>
      <ToastProvider>
        <SearchScreen bookmarks={guest} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

// 지도 인증 실패는 페이지 세션(place-map 모듈)에 남는다. 그 테스트는 모듈을 새로 읽어 새 페이지 세션에서 그린다.
// React Query는 node_modules라 다시 읽히지 않아 같은 Provider를 쓴다
async function renderInNewPageSession() {
  vi.resetModules();
  const [screenModule, toastModule] = await Promise.all([
    import("./search-screen"),
    import("@/shared/ui/overlay/toast"),
  ]);
  const Screen = screenModule.SearchScreen;
  const Toasts = toastModule.ToastProvider;
  return render(
    <QueryClientProvider client={newClient()}>
      <Toasts>
        <Screen bookmarks={guest} />
      </Toasts>
    </QueryClientProvider>,
  );
}

// 다른 화면으로 가면 Next가 이 화면을 숨겨 두었다가(Effect 정리) 돌아오면 다시 보인다. 그 숨김을 흉내 낸다
function renderHideableScreen() {
  const client = newClient();
  const ui = (mode: "visible" | "hidden") => (
    <QueryClientProvider client={client}>
      <ToastProvider>
        <Activity mode={mode}>
          <SearchScreen bookmarks={guest} />
        </Activity>
      </ToastProvider>
    </QueryClientProvider>
  );
  const { rerender } = render(ui("visible"));
  return {
    hide: () => rerender(ui("hidden")),
    show: () => rerender(ui("visible")),
  };
}

const mapState = () =>
  document.querySelector("[data-map-state]")?.getAttribute("data-map-state");

// 지도가 그려지고 검색 화면도 그 알림을 받은 뒤. data-map-state는 PlaceMap이 바로 그리지만, 지도 위 버튼("내 위치",
// "이 지역에서 검색")은 검색 화면이 onReadyChange를 받은 다음 렌더에 그린다. 그 사이 한 commit에는 버튼이 없다
async function mapReady() {
  await waitFor(() => {
    expect(mapState()).toBe("ready");
    expect(screen.getByRole("button", { name: "내 위치" })).toBeTruthy();
  });
}

async function newSearch(text: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "장소 검색" }), {
    target: { value: text },
  });
  fireEvent.submit(screen.getByRole("search"));
  return screen.findByRole("list", { name: "추천 장소" });
}

function sendFollowUp(text: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "후속 조건" }), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: "보내기" }));
}

// 후속 입력은 제목이 아니라 칩으로 보인다(D-97)
async function followUp(text: string) {
  sendFollowUp(text);
  expect(await screen.findByText(`추가 조건 · ${text}`)).toBeTruthy();
}

// 결과 패널 머리글의 "요청 기록"으로 패널 안에 펼친다
async function openHistory() {
  fireEvent.click(screen.getByRole("button", { name: "요청 기록" }));
  return screen.findByRole("list", { name: "요청 기록" });
}

const pastView = () => screen.findByRole("region", { name: "과거 결과" });

// 검색 요청(/places/search, /places/search/region)만 붙잡는다. held[i]()가 그 요청을 놓고 원래 응답의 Promise를 돌려준다
function holdSearches() {
  const original = globalThis.fetch;
  const held: Array<() => Promise<Response>> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>((input, init) => {
      if (!String(input).includes("/search")) return original(input, init);
      let release = () => {};
      const gate = new Promise<void>((resolve) => (release = resolve));
      const response = gate.then(() => original(input, init));
      held.push(() => {
        release();
        return response;
      });
      return response;
    }),
  );
  return held;
}

// 붙잡은 응답을 놓고, 그 응답을 받은 쪽이 처리를 끝낼 때까지(fetch 끝, query와 mutation 끝, 그 뒤 렌더와 effect) 기다린다.
// 늦은 응답이 화면을 바꾸지 않았다는 단언은 이 뒤에 한다
async function releaseAndSettle(release: () => Promise<Response>) {
  await act(async () => {
    await release();
  });
  await waitFor(() => {
    expect(clients.at(-1)!.isFetching()).toBe(0);
    expect(clients.at(-1)!.isMutating()).toBe(0);
  });
  await act(async () => {});
}

beforeEach(() => {
  stores.current = createSearchStore();
  stubApi();
  config.value = undefined;
  // 브라우저처럼 observe하면 지금 크기를 한 번 알린다. 크기 적용을 기다리는 테스트는 따로 바꿔 끼운다
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(private readonly callback: ResizeObserverCallback) {}
      observe(target: Element) {
        const { width, height } = target.getBoundingClientRect();
        this.callback(
          [{ target, contentRect: { width, height } } as ResizeObserverEntry],
          this as unknown as ResizeObserver,
        );
      }
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
  // 첫 화면 주변 카드의 Carousel(Embla)이 부른다. jsdom에는 없다
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  localStorage.clear();
});

// 실패한 테스트도 다음 테스트에 남기지 않도록 여기서 되돌린다
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  focusManager.setFocused(undefined);
  onlineManager.setOnline(true);
  document.head
    .querySelectorAll('script[src*="oapi.map.naver.com"]')
    .forEach((script) => script.remove());
  delete window.navermap_authFailure;
  push.mockReset();
});

// 화면을 열 때 보는 위치 권한과 기기 위치. permission이 없으면 Permissions API가 없는 브라우저다
function stubLocation({
  permission,
  position,
}: {
  permission?: PermissionState;
  position?: { lat: number; lng: number };
}) {
  const getCurrentPosition = vi.fn(
    (success: PositionCallback, error: PositionErrorCallback) =>
      position
        ? success({
            coords: { latitude: position.lat, longitude: position.lng },
          } as GeolocationPosition)
        : error({ code: 1 } as GeolocationPositionError),
  );
  vi.stubGlobal("navigator", {
    geolocation: { getCurrentPosition },
    ...(permission && {
      permissions: { query: async () => ({ state: permission }) },
    }),
  });
  return getCurrentPosition;
}

// 첫 화면 주변 카드 요청에만 다른 항목을 돌려준다
function stubNearbyItems(items: PlaceCard[]) {
  const original = globalThis.fetch;
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      if (String(input) === "/api/v1/places/nearby") {
        await original(input, init);
        return Response.json({
          conditions: {},
          nearby: true,
          totalCount: items.length,
          items,
        } satisfies PlaceSearchResponse);
      }
      return original(input, init);
    }),
  );
}

const nearbyList = () =>
  screen.findByRole("region", { name: "주변 추천 장소" });

// 홈 영역을 확정해 카드를 받기 전의 카드 자리(spec 73번)
const SKELETON = "주변 추천을 불러오는 중";
const skeleton = () => screen.queryByRole("status", { name: SKELETON });

// 지도를 쓸 수 없어 홈 영역을 정할 수 없을 때 카드 자리의 안내(spec 75번)
const MAP_FAILED_TITLE = "지도를 불러오지 못했어요";

// 처음 이동(panTo)이 끝난 화면의 영역. 이동 전 영역(BOUNDS)과 달라야 처음 홈 요청이 이동 뒤 화면으로 나갔는지 가린다.
// 0.001도 격자 위라 정규화해도 그대로다
const AFTER_INITIAL_MOVE = {
  swLat: 37.495,
  swLng: 127.025,
  neLat: 37.505,
  neLng: 127.035,
};
const MAP_FAILED_DESCRIPTION =
  "주변 추천을 보려면 지도가 필요해요. 아래 검색창으로 장소를 직접 찾아볼 수 있어요.";

const HERE = { lat: 37.5, lng: 127.03 };

// 권한은 허용이고 위치 조회는 테스트가 끝낼 때까지 기다린다. 부른 순서대로 끝낸다
function stubLocationLater() {
  const pending: { success: PositionCallback; error: PositionErrorCallback }[] =
    [];
  const getCurrentPosition = vi.fn(
    (success: PositionCallback, error: PositionErrorCallback) => {
      pending.push({ success, error });
    },
  );
  vi.stubGlobal("navigator", {
    geolocation: { getCurrentPosition },
    permissions: { query: async () => ({ state: "granted" }) },
  });
  return {
    getCurrentPosition,
    succeed: () =>
      act(async () =>
        pending.shift()!.success({
          coords: { latitude: HERE.lat, longitude: HERE.lng },
        } as GeolocationPosition),
      ),
    fail: () =>
      act(async () =>
        pending.shift()!.error({ code: 1 } as GeolocationPositionError),
      ),
  };
}

describe("SearchScreen", () => {
  describe("지도가 있을 때", () => {
    let map: ReturnType<typeof stubNaverMaps>;
    const regionButton = () =>
      screen.queryByRole("button", { name: "이 지역에서 검색" });

    beforeEach(() => {
      config.value = { env: "dev", naverMapClientId: "key" };
      map = stubNaverMaps();
    });

    describe("검색 지역과 결과 맞춤 이동 (S15P31A302-203)", () => {
      // 화면 배치 흉내. 지도와 화면은 높이 800·폭 400이고 첫 화면 아래 묶음의 위 끝은 500이다.
      // 키보드가 열려 위로 들린 검색창은 위 끝이 100이다(묶음 크기에는 들지 않는다)
      function stubLayout() {
        const rect = (top: number, height: number) =>
          ({
            top,
            bottom: top + height,
            height,
            left: 0,
            right: 400,
            width: 400,
            x: 0,
            y: top,
            toJSON() {},
          }) as DOMRect;
        vi.spyOn(
          HTMLElement.prototype,
          "getBoundingClientRect",
        ).mockImplementation(function (this: HTMLElement) {
          if (this.hasAttribute("data-map-state") || this.tagName === "MAIN") {
            return rect(0, 800);
          }
          if (this.getAttribute("role") === "search") return rect(100, 60);
          if (
            this.className.includes("bottom-0") &&
            this.querySelector('[role="search"]')
          ) {
            return rect(500, 300);
          }
          return rect(0, 0);
        });
      }
      // 첫 화면: 지도 800에서 아래 묶음과 겹친 300을 뺀 띠(0~500). 가짜 지도는 화면 왼쪽 위가 getBounds()의
      // 북서 모서리(37.51, 127.02)이고 아래로 1000px마다 위도 1도, 오른쪽으로 1000px마다 경도 1도다
      const HOME_AREA = {
        swLat: 37.01,
        swLng: 127.02,
        neLat: 37.51,
        neLng: 127.42,
      };
      // 결과 화면: 중간 패널 위 끝(320) 위의 띠(0~320)
      const PANEL_AREA = {
        swLat: 37.19,
        swLng: 127.02,
        neLat: 37.51,
        neLng: 127.42,
      };
      const REGION_URL = "/api/v1/places/search/region";
      const SEARCH_URL = "/api/v1/places/search";
      const GUEST_THREADS = "fit-dining:guest-search-threads";

      afterEach(() => {
        vi.restoreAllMocks();
      });

      async function regionSearch() {
        map.fire("dragend");
        fireEvent.click(
          await screen.findByRole("button", { name: "이 지역에서 검색" }),
        );
        const count = stores.current.getSnapshot().entries.length;
        await waitFor(() =>
          expect(stores.current.getSnapshot().entries.length).toBe(count + 1),
        );
      }

      // 재로드 뒤처럼 기기에 저장된 thread 하나를 최근 검색에서 연다
      async function openStoredThread(
        turns: object[],
        beforeOpen?: () => void,
      ) {
        localStorage.setItem(
          GUEST_THREADS,
          JSON.stringify([{ id: "thread-old", turns }]),
        );
        renderScreen();
        await mapReady();
        beforeOpen?.();
        fireEvent.click(screen.getByRole("button", { name: "최근 검색" }));
        const sheet = await screen.findByRole("dialog", { name: "최근 검색" });
        const row = within(
          within(sheet).getByRole("list", { name: "최근 검색 목록" }),
        )
          .getAllByRole("button")
          .find((button) => !button.hasAttribute("aria-label"))!;
        fireEvent.click(row);
        await waitFor(() =>
          expect(stores.current.getSnapshot().threadId).toBe("thread-old"),
        );
      }

      const firstPage = (conditions: object, count = 1) => ({
        conditions,
        nearby: false,
        totalCount: count,
        items: count ? [card(7)] : [],
      });

      // 새 검색 a, region b, 후속 c. b의 요청은 테스트가 정한다(옛 모양, 영역 없음 등)
      const storedTurns = (regionRequest: object) => [
        {
          id: "a",
          kind: "new",
          at: 100,
          request: { query: "강남역 파스타", mapBounds: BOUNDS },
          response: firstPage({ area: "강남역" }),
        },
        {
          id: "b",
          kind: "region",
          baseId: "a",
          at: 200,
          request: regionRequest,
          response: firstPage({ menu: "파스타" }),
        },
        {
          id: "c",
          kind: "followUp",
          baseId: "a",
          at: 300,
          request: {
            query: "조용한 곳",
            previousConditions: { area: "강남역" },
            mapBounds: BOUNDS,
          },
          response: firstPage({ area: "강남역", quiet: true }),
        },
      ];

      async function openPastOf(index: number) {
        const history = await openHistory();
        fireEvent.click(
          within(history).getAllByRole("button", { name: "결과 보기" })[index],
        );
        return pastView();
      }

      it.each([
        ["granted", { permission: "granted", position: HERE }],
        ["denied", { permission: "denied" }],
        ["prompt", { permission: "prompt" }],
      ] as const)(
        "위치 권한이 %s여도 새 검색은 보내는 순간 보이는 영역을 담고 '새 검색' 뒤에도 같다 (AC-53)",
        async (permission, location) => {
          stubLocation(location);
          stubLayout();
          renderScreen();
          await mapReady();
          if (permission === "granted") {
            await waitFor(() =>
              expect(map.created[0].panTo).toHaveBeenCalled(),
            );
            map.fire("idle");
          }
          await waitFor(() =>
            expect(stores.current.getSnapshot().initialView).toBe("done"),
          );

          await newSearch("역삼 카페");
          fireEvent.click(screen.getByRole("button", { name: "새 검색" }));
          await newSearch("강남 술집");

          expect(searchBodies.map((body) => body.mapBounds)).toEqual([
            HOME_AREA,
            HOME_AREA,
          ]);
        },
      );

      it("키보드로 검색창이 위로 들려 있어도(검색창 위 끝 100) 아래 묶음 위 끝으로 잰 입력 전 화면의 영역이다 (AC-53, AC-54)", async () => {
        stubLayout();
        renderScreen();
        await mapReady();
        const input = screen.getByRole("textbox", { name: "장소 검색" });

        fireEvent.focus(input);
        fireEvent.change(input, { target: { value: "역삼 카페" } });
        fireEvent.submit(screen.getByRole("search"));
        await screen.findByRole("list", { name: "추천 장소" });

        expect(searchBodies[0].mapBounds).toEqual(HOME_AREA);
      });

      it("화면 좌표를 위경도로 바꾸다 SDK가 던지면 지도 전체 영역을 담는다 (AC-54)", async () => {
        stubLayout();
        renderScreen();
        await mapReady();
        Object.assign(map.created[0], {
          getProjection: () => {
            throw new Error("변환 실패");
          },
        });

        await newSearch("역삼 카페");

        expect(searchBodies[0].mapBounds).toEqual(BOUNDS);
      });

      it("배치를 잴 수 없으면(보이는 띠가 너무 작음) 지도 전체 영역을 담는다 (AC-54)", async () => {
        renderScreen();
        await mapReady();

        await newSearch("역삼 카페");

        expect(searchBodies[0].mapBounds).toEqual(BOUNDS);
      });

      it("후속 조건은 지도를 옮겨도 기준 항목의 영역을 잇고, region 항목이 기준이면 그 영역이다 (AC-55)", async () => {
        stubLayout();
        renderScreen();
        await mapReady();
        await newSearch("역삼 카페");

        map.fire("dragend");
        await followUp("더 조용하게");
        await regionSearch();
        await followUp("카페 말고 식당");

        expect(searchBodies.map((body) => body.mapBounds)).toEqual([
          HOME_AREA,
          HOME_AREA,
          PANEL_AREA,
          PANEL_AREA,
        ]);
        expect(searchUrls).toEqual([
          SEARCH_URL,
          SEARCH_URL,
          REGION_URL,
          SEARCH_URL,
        ]);
      });

      it("'이 지역에서 검색'은 region API로 보던 항목의 문장과 conditions, 패널 위로 보이는 영역을 보내고 previousConditions는 없다 (AC-56)", async () => {
        stubLayout();
        renderScreen();
        await mapReady();
        await newSearch("역삼 카페");
        await followUp("더 조용하게");

        await regionSearch();

        expect(searchUrls.at(-1)).toBe(REGION_URL);
        expect(searchBodies.at(-1)).toEqual({
          query: "더 조용하게",
          conditions: { area: "역삼", quiet: true },
          mapBounds: PANEL_AREA,
        });
        const entries = stores.current.getSnapshot().entries;
        expect(entries.at(-1)).toMatchObject({
          kind: "region",
          sentence: "더 조용하게",
        });
        // 쿼리 키는 항목 id 그대로다
        const saved = JSON.parse(localStorage.getItem(GUEST_THREADS)!);
        expect(saved[0].turns.at(-1).request).toEqual(searchBodies.at(-1));
      });

      describe("끌기·panTo처럼 확대 정도가 그대로인 이동 뒤의 보이는 영역 (AC-53, AC-56, AC-70)", () => {
        // 옮긴 뒤 화면. 왼쪽 위가 (37.53, 127.06)이다. 가짜 지도의 offset 원점은 확대 정도가 바뀔 때만 다시 잡혀
        // 옮기기 전 화면에 남는다(실제 SDK의 pane처럼)
        const MOVED = {
          swLat: 37.52,
          swLng: 127.06,
          neLat: 37.53,
          neLng: 127.08,
        };
        // MOVED의 왼쪽 위에서 잰 띠. 검색 요청의 영역은 정규화하지 않아 부동소수점 끝자리까지는 보지 않는다
        // (홈 요청은 0.001도 격자로 정규화해 같은 값이다)
        const movedBand = (bottom: number) => ({
          swLat: expect.closeTo(37.53 - bottom / 1000, 6),
          swLng: expect.closeTo(127.06, 6),
          neLat: expect.closeTo(37.53, 6),
          neLng: expect.closeTo(127.46, 6),
        });

        it("처음 이동(panTo) 뒤 처음 홈 요청은 옮긴 화면의 띠 영역이다 (AC-70)", async () => {
          const device = stubLocationLater();
          stubLayout();
          renderScreen();
          await mapReady();
          await waitFor(() =>
            expect(device.getCurrentPosition).toHaveBeenCalled(),
          );

          await device.succeed();
          await waitFor(() => expect(map.created[0].panTo).toHaveBeenCalled());
          map.view.bounds = MOVED;
          map.fire("idle");

          await nearbyList();
          expect(nearbyBodies).toEqual([{ mapBounds: movedBand(500) }]);
        });

        it("결과 화면에서 끈 뒤 '이 지역에서 검색'은 끈 화면의 패널 위 띠 영역이다 (AC-56)", async () => {
          stubLayout();
          renderScreen();
          await mapReady();
          await newSearch("역삼 카페");

          map.view.bounds = MOVED;
          await regionSearch();

          expect(searchUrls.at(-1)).toBe(REGION_URL);
          expect(searchBodies.at(-1)?.mapBounds).toEqual(movedBand(320));
        });

        it("홈에서 카드를 눌러 지도를 옮긴 뒤 새 검색은 옮긴 화면의 띠 영역이다 (AC-53)", async () => {
          stubLayout();
          renderScreen();
          await mapReady();
          const list = await nearbyList();

          fireEvent.click(
            within(list)
              .getAllByRole("button")
              .filter((button) => button.hasAttribute("aria-pressed"))[1],
          );
          expect(map.created[0].panTo).toHaveBeenCalled();
          map.view.bounds = MOVED;
          map.fire("idle");
          await newSearch("역삼 카페");

          expect(searchBodies.at(-1)?.mapBounds).toEqual(movedBand(500));
        });
      });

      it("region의 다음 페이지와 실패 뒤 재시도도 region API로 같은 본문을 보낸다 (AC-56)", async () => {
        const original = globalThis.fetch;
        let failRegion = true;
        vi.stubGlobal(
          "fetch",
          vi.fn<typeof fetch>(async (input, init) => {
            const url = String(input);
            if (url === REGION_URL) {
              const body = JSON.parse(String(init?.body));
              searchBodies.push(body);
              searchUrls.push(url);
              if (failRegion) {
                failRegion = false;
                return Response.json({ status: 400 }, { status: 400 });
              }
              return Response.json({
                conditions: {},
                nearby: false,
                totalCount: 3,
                items: body.cursor ? [card(3)] : [card(1), card(2)],
                ...(!body.cursor && { nextCursor: "Mg" }),
              } satisfies PlaceSearchResponse);
            }
            return original(input, init);
          }),
        );
        vi.stubGlobal(
          "IntersectionObserver",
          class {
            constructor(
              private readonly callback: (
                entries: { isIntersecting: boolean }[],
              ) => void,
            ) {}
            observe() {
              this.callback([{ isIntersecting: true }]);
            }
            disconnect() {}
          },
        );
        renderScreen();
        await mapReady();
        await newSearch("역삼 카페");

        map.fire("dragend");
        fireEvent.click(
          await screen.findByRole("button", { name: "이 지역에서 검색" }),
        );
        fireEvent.click(
          await screen.findByRole("button", { name: "다시 시도" }),
        );
        await waitFor(() =>
          expect(searchBodies.filter((body) => body.cursor)).toHaveLength(1),
        );

        // 맞춤 이동은 첫 새 검색의 한 번뿐이다(region과 다음 페이지는 옮기지 않는다)
        expect(map.created[0].fitBounds).toHaveBeenCalledTimes(1);
        const region = {
          query: "역삼 카페",
          conditions: { area: "역삼" },
          mapBounds: BOUNDS,
        };
        expect(searchUrls.slice(1)).toEqual([
          REGION_URL,
          REGION_URL,
          REGION_URL,
        ]);
        expect(searchBodies.slice(1)).toEqual([
          region,
          region,
          { ...region, cursor: "Mg" },
        ]);
      });

      it("region 기록을 다시 검색하면 새 모양은 저장된 본문을, 옛 모양은 previousConditions 없이 응답 conditions를 region API로 보내고 저장된 기록은 그대로다 (AC-39, AC-57, AC-59)", async () => {
        const legacy = {
          query: "강남역 파스타",
          previousConditions: { area: "강남역" },
          mapBounds: BOUNDS,
        };
        await openStoredThread(storedTurns(legacy));
        expect(searchBodies).toHaveLength(0);

        const past = await openPastOf(1);
        fireEvent.click(
          within(past).getByRole("button", { name: "이 조건으로 다시 검색" }),
        );
        await waitFor(() => expect(searchBodies).toHaveLength(1));

        expect(searchUrls).toEqual([REGION_URL]);
        expect(searchBodies[0]).toEqual({
          query: "강남역 파스타",
          conditions: { menu: "파스타" },
          mapBounds: BOUNDS,
        });
        await waitFor(() =>
          expect(stores.current.getSnapshot().entries).toHaveLength(4),
        );
        const saved = JSON.parse(localStorage.getItem(GUEST_THREADS)!);
        expect(saved[0].turns.slice(0, 3)).toEqual(storedTurns(legacy));
        expect(saved[0].turns[3].request).toEqual(searchBodies[0]);
      });

      it.each([
        ["저장된 conditions", { a: 1 }, { a: 1 }],
        ["conditions가 null이면 응답 conditions", null, { menu: "파스타" }],
      ])(
        "새 모양 region 기록을 다시 검색하면 %s로 region API를 부른다 (AC-57)",
        async (_, conditions, sent) => {
          await openStoredThread(
            storedTurns({
              query: "강남역 파스타",
              conditions,
              mapBounds: BOUNDS,
            }),
          );

          const past = await openPastOf(1);
          fireEvent.click(
            within(past).getByRole("button", { name: "이 조건으로 다시 검색" }),
          );
          await waitFor(() => expect(searchBodies).toHaveLength(1));

          expect(searchUrls).toEqual([REGION_URL]);
          expect(searchBodies[0]).toEqual({
            query: "강남역 파스타",
            conditions: sent,
            mapBounds: BOUNDS,
          });
        },
      );

      it("new 기록을 다시 검색하면 저장된 본문 그대로 /places/search로 간다 (AC-39, AC-57)", async () => {
        await openStoredThread(storedTurns({ query: "x", mapBounds: BOUNDS }));

        const past = await openPastOf(0);
        fireEvent.click(
          within(past).getByRole("button", { name: "이 조건으로 다시 검색" }),
        );
        await waitFor(() => expect(searchBodies).toHaveLength(1));

        expect(searchUrls).toEqual([SEARCH_URL]);
        expect(searchBodies[0]).toEqual({
          query: "강남역 파스타",
          mapBounds: BOUNDS,
        });
      });

      it("영역이 없는 region 기록은 결과가 보이고, 다시 검색은 HTTP 없이 안내만 띄우며, 그 기록에서 이 지역에서 검색과 영역 없는 후속 조건은 된다 (AC-58)", async () => {
        stubLayout();
        await openStoredThread(
          storedTurns({ query: "강남역 파스타", previousConditions: {} }),
        );

        const past = await openPastOf(1);
        expect(within(past).getByText("장소 7")).toBeTruthy();
        fireEvent.click(
          within(past).getByRole("button", { name: "이 조건으로 다시 검색" }),
        );

        expect(await screen.findByText("다시 검색할 수 없어요")).toBeTruthy();
        expect(searchBodies).toHaveLength(0);
        expect(screen.getByRole("region", { name: "과거 결과" })).toBeTruthy();

        fireEvent.click(screen.getByRole("button", { name: "현재 검색으로" }));
        const history = await screen.findByRole("list", { name: "요청 기록" });
        fireEvent.click(
          within(history).getAllByRole("button", {
            name: "여기서 이어 검색",
          })[1],
        );
        await followUp("조용한 곳");
        expect(searchBodies[0]).toEqual({
          query: "조용한 곳",
          previousConditions: { menu: "파스타" },
        });

        const reopened = await openHistory();
        fireEvent.click(
          within(reopened).getAllByRole("button", {
            name: "여기서 이어 검색",
          })[1],
        );
        await regionSearch();
        expect(searchUrls.at(-1)).toBe(REGION_URL);
        expect(searchBodies.at(-1)).toEqual({
          query: "강남역 파스타",
          conditions: { menu: "파스타" },
          mapBounds: PANEL_AREA,
        });
      });

      it("thread를 열면 검색 HTTP, 지도 이동, 저장소 쓰기가 없다 (AC-59)", async () => {
        const setItem = vi.spyOn(Storage.prototype, "setItem");
        await openStoredThread(storedTurns({ query: "강남역 파스타" }));
        await act(async () => {});

        expect(searchBodies).toHaveLength(0);
        const [created] = map.created;
        expect(created.panTo).not.toHaveBeenCalled();
        expect(created.fitBounds).not.toHaveBeenCalled();
        expect(created.morph).not.toHaveBeenCalled();
        expect(
          setItem.mock.calls.filter(([key]) => key === GUEST_THREADS),
        ).toHaveLength(1);
      });

      it.each(["dragend", "zoom_changed"])(
        "홈에서 지도를 %s로 옮긴 뒤 최근 검색으로 thread를 열어도 '이 지역에서 검색'이 없고, 그 결과 화면에서 옮기면 나타난다 (spec 39번)",
        async (event) => {
          await openStoredThread(
            storedTurns({ query: "강남역 파스타", mapBounds: BOUNDS }),
            () => {
              map.fire(event);
              map.fire("idle");
            },
          );
          await act(async () => {});

          expect(stores.current.getSnapshot().entries).toHaveLength(3);
          expect(regionButton()).toBeNull();

          map.fire(event);

          expect(regionButton()).toBeTruthy();
        },
      );

      it("AI 대체 결과의 안내는 region 항목이면 지도 안 문구, 새 검색이면 지금 문구다(과거 결과 화면도) (AC-60)", async () => {
        aiFallback.search = true;
        const REGION_NOTICE =
          "지도 안의 장소만 보여드려요. 검색 조건은 적용되지 않았어요";
        const SEARCH_NOTICE =
          "지금은 AI 추천을 쓸 수 없어 가게 이름·메뉴로 찾았어요";
        renderScreen();
        await mapReady();
        await newSearch("역삼 카페");
        expect(screen.getByText(SEARCH_NOTICE)).toBeTruthy();

        await regionSearch();
        expect(await screen.findByText(REGION_NOTICE)).toBeTruthy();
        expect(screen.queryByText(SEARCH_NOTICE)).toBeNull();

        await followUp("더 조용하게");
        const past = await openPastOf(1);
        expect(within(past).getByText(REGION_NOTICE)).toBeTruthy();
      });

      describe("결과 맞춤 이동 (AC-61, AC-62)", () => {
        it("새 검색의 첫 페이지(2곳)에 fitBounds를 한 번 부르고 여백은 패널과 겹친 높이 + 40, 위 safe-area + 40, 옆 40이다", async () => {
          stubLayout();
          renderScreen();
          await mapReady();

          await newSearch("역삼 카페");

          const [created] = map.created;
          expect(created.fitBounds).toHaveBeenCalledTimes(1);
          const [bounds, margin] = created.fitBounds.mock.calls[0];
          expect([
            bounds.sw.lat(),
            bounds.sw.lng(),
            bounds.ne.lat(),
            bounds.ne.lng(),
          ]).toEqual([37.5, 127.03, 37.5, 127.03]);
          expect(margin).toEqual({
            top: 40,
            right: 40,
            bottom: 480 + 40,
            left: 40,
            maxZoom: 17,
          });
          expect(created.panTo).not.toHaveBeenCalled();
        });

        it("1곳이면 확대 정도 그대로 panTo, 0곳·region·다음 결과 보기·이어 검색에서는 맞춤 이동이 없다", async () => {
          renderScreen();
          await mapReady();
          await newSearch("역삼 카페");
          const [created] = map.created;

          await followUp("더 조용하게");
          expect(created.fitBounds).toHaveBeenCalledTimes(1);
          expect(created.panTo).toHaveBeenCalledTimes(1);
          expect(created.setZoom).not.toHaveBeenCalled();

          await regionSearch();
          const history = await openHistory();
          fireEvent.click(
            within(history).getAllByRole("button", { name: "결과 보기" })[0],
          );
          await pastView();
          fireEvent.click(
            screen.getByRole("button", { name: "현재 검색으로" }),
          );
          const again = await screen.findByRole("list", { name: "요청 기록" });
          fireEvent.click(
            within(again).getAllByRole("button", {
              name: "여기서 이어 검색",
            })[0],
          );
          await act(async () => {});
          expect(created.fitBounds).toHaveBeenCalledTimes(1);
          expect(created.panTo).toHaveBeenCalledTimes(1);

          sendFollowUp("없는 조건");
          await screen.findByText("찾지 못했어요");
          expect(created.fitBounds).toHaveBeenCalledTimes(1);
          expect(created.panTo).toHaveBeenCalledTimes(1);
        });

        it("첫 화면 주변 카드, 버린 검색의 늦은 응답으로는 맞춤 이동이 없다", async () => {
          renderScreen();
          await mapReady();
          await nearbyList();
          const [created] = map.created;
          expect(created.fitBounds).not.toHaveBeenCalled();

          await newSearch("역삼 카페");
          expect(created.fitBounds).toHaveBeenCalledTimes(1);
          const held = holdSearches();
          sendFollowUp("더 조용하게");
          await waitFor(() => expect(held).toHaveLength(1));
          fireEvent.click(screen.getByRole("button", { name: "새 검색" }));
          await releaseAndSettle(held[0]);

          expect(created.fitBounds).toHaveBeenCalledTimes(1);
          expect(created.panTo).not.toHaveBeenCalled();
        });

        it("새 검색의 다음 페이지로는 맞춤 이동이 없다", async () => {
          const original = globalThis.fetch;
          vi.stubGlobal(
            "fetch",
            vi.fn<typeof fetch>(async (input, init) => {
              const body = init?.body ? JSON.parse(String(init.body)) : {};
              if (body.query !== "역삼 카페") return original(input, init);
              searchBodies.push(body);
              return Response.json({
                conditions: {},
                nearby: false,
                totalCount: 3,
                items: body.cursor ? [card(3)] : [card(1), card(2)],
                ...(!body.cursor && { nextCursor: "Mg" }),
              } satisfies PlaceSearchResponse);
            }),
          );
          vi.stubGlobal(
            "IntersectionObserver",
            class {
              constructor(
                private readonly callback: (
                  entries: { isIntersecting: boolean }[],
                ) => void,
              ) {}
              observe() {
                this.callback([{ isIntersecting: true }]);
              }
              disconnect() {}
            },
          );
          renderScreen();
          await mapReady();

          await newSearch("역삼 카페");
          await waitFor(() =>
            expect(searchBodies.filter((body) => body.cursor)).toHaveLength(1),
          );
          await screen.findByText("장소 3");

          const [created] = map.created;
          expect(created.fitBounds).toHaveBeenCalledTimes(1);
          expect(created.panTo).not.toHaveBeenCalled();
        });

        it("재시도와 '이 조건으로 다시 검색'도 맞춤 이동한다", async () => {
          const original = globalThis.fetch;
          let fail = true;
          vi.stubGlobal(
            "fetch",
            vi.fn<typeof fetch>(async (input, init) => {
              const body = init?.body ? JSON.parse(String(init.body)) : {};
              if (body.query === "역삼 카페" && fail) {
                fail = false;
                return Response.json({ status: 400 }, { status: 400 });
              }
              return original(input, init);
            }),
          );
          renderScreen();
          await mapReady();
          fireEvent.change(screen.getByRole("textbox", { name: "장소 검색" }), {
            target: { value: "역삼 카페" },
          });
          fireEvent.submit(screen.getByRole("search"));
          fireEvent.click(
            await screen.findByRole("button", { name: "다시 시도" }),
          );
          await screen.findByRole("list", { name: "추천 장소" });
          const [created] = map.created;
          expect(created.fitBounds).toHaveBeenCalledTimes(1);

          await followUp("더 조용하게");
          const past = await openPastOf(0);
          fireEvent.click(
            within(past).getByRole("button", { name: "이 조건으로 다시 검색" }),
          );
          await waitFor(() =>
            expect(created.fitBounds).toHaveBeenCalledTimes(2),
          );
        });

        it("근처 응답도 위치를 기다리지 않고 거르지 않은 핀 전부로 맞추며, 남은 처음 이동은 하지 않는다 (AC-61, AC-52)", async () => {
          const device = stubLocationLater();
          renderScreen();
          await mapReady();
          await waitFor(() =>
            expect(device.getCurrentPosition).toHaveBeenCalled(),
          );

          await newSearch("근처 카페");

          const [created] = map.created;
          expect(created.fitBounds).toHaveBeenCalledTimes(1);
          // 1번(역삼역 앞)과 2km 떨어진 3번이 모두 사각형에 든다
          const [rect] = created.fitBounds.mock.calls[0] as [
            { sw: { lat(): number }; ne: { lat(): number } },
          ];
          expect([rect.sw.lat(), rect.ne.lat()]).toEqual([37.5, 37.518]);
          expect(stores.current.getSnapshot().initialView).toBe("done");
          await device.succeed();
          await act(async () => {});
          expect(created.panTo).not.toHaveBeenCalled();
        });

        it("처음 이동이 남은 채 맞춤 이동하면 처음 이동은 하지 않고, 늦게 온 위치는 내 위치로만 남는다 (AC-32, AC-48)", async () => {
          const device = stubLocationLater();
          renderScreen();
          await mapReady();
          await waitFor(() =>
            expect(device.getCurrentPosition).toHaveBeenCalled(),
          );

          await newSearch("역삼 카페");
          expect(stores.current.getSnapshot().initialView).toBe("done");
          await device.succeed();
          await act(async () => {});

          const [created] = map.created;
          expect(created.fitBounds).toHaveBeenCalledTimes(1);
          expect(created.panTo).not.toHaveBeenCalled();
          expect(stores.current.getSnapshot().location).toEqual({
            status: "ok",
            here: HERE,
          });
        });

        it("맞춤 이동의 확대·축소로는 '이 지역에서 검색'이 나타나지 않고, 그 뒤 사용자가 확대·축소하면 나타난다", async () => {
          renderScreen();
          await mapReady();

          await newSearch("역삼 카페");
          expect(regionButton()).toBeNull();
          map.fire("idle");
          expect(regionButton()).toBeNull();

          map.fire("zoom_changed");
          expect(regionButton()).toBeTruthy();
        });

        it("맞춤 이동이 지도를 움직이지 않았으면 바로 다음 사용자 확대·축소로 나타난다", async () => {
          map.fit.zoom = 15;
          renderScreen();
          await mapReady();

          await newSearch("역삼 카페");
          expect(map.created[0].fitBounds).toHaveBeenCalledTimes(1);
          expect(regionButton()).toBeNull();

          map.fire("zoom_changed");
          expect(regionButton()).toBeTruthy();
        });

        it("핀이 가까워 더 확대될 자리여도 fitBounds의 maxZoom으로 확대 정도는 17이고, 따로 setZoom을 부르지 않는다", async () => {
          map.fit.zoom = 19;
          renderScreen();
          await mapReady();

          await newSearch("역삼 카페");

          const [created] = map.created;
          expect(created.getZoom.mock.results.at(-1)?.value).toBe(17);
          expect(created.setZoom).not.toHaveBeenCalled();
          expect(regionButton()).toBeNull();
          map.fire("idle");
          map.fire("zoom_changed");
          expect(regionButton()).toBeTruthy();
        });

        it("맞춤 이동이 멈추기 전에 '내 위치'로 옮겨도 그 이동 뒤에 확대 정도를 바꾸지 않는다", async () => {
          stubLocation({ position: HERE });
          map.fit.zoom = 19;
          renderScreen();
          await mapReady();
          await newSearch("역삼 카페");
          const [created] = map.created;

          fireEvent.click(screen.getByRole("button", { name: "내 위치" }));
          await waitFor(() =>
            expect(created.morph).toHaveBeenCalledWith(expect.anything(), 15),
          );
          map.fire("idle");

          expect(created.setZoom).not.toHaveBeenCalled();
        });
      });
    });

    describe("'이 지역에서 검색' 버튼", () => {
      it.each(["dragend", "zoom_changed"])(
        "결과가 있어도 지도를 움직이기 전에는 없고, %s 뒤에 나타난다",
        async (event) => {
          renderScreen();
          await mapReady();
          await newSearch("역삼 카페");
          expect(regionButton()).toBeNull();
          // 결과 맞춤 이동이 멈춘 뒤의 사용자 조작이다(spec 69번)
          map.fire("idle");

          map.fire(event);

          expect(regionButton()).toBeTruthy();
        },
      );

      it("카드를 눌러 지도가 옮겨 가도 나타나지 않는다", async () => {
        renderScreen();
        await mapReady();
        const list = await newSearch("역삼 카페");

        fireEvent.click(within(list).getAllByRole("button")[1]);

        expect(map.created[0].panTo).toHaveBeenCalled();
        expect(regionButton()).toBeNull();
      });

      it("누르거나, 보는 결과가 바뀌거나, '새 검색'을 누르면 숨는다", async () => {
        renderScreen();
        await mapReady();
        await newSearch("역삼 카페");

        map.fire("dragend");
        fireEvent.click(regionButton()!);
        expect(regionButton()).toBeNull();
        await waitFor(() =>
          expect(stores.current.getSnapshot().entries).toHaveLength(2),
        );

        map.fire("dragend");
        await followUp("더 조용하게");
        expect(regionButton()).toBeNull();

        map.fire("dragend");
        const history = await openHistory();
        expect(regionButton()).toBeNull();
        fireEvent.click(
          within(history).getAllByRole("button", { name: "결과 보기" })[0],
        );
        await pastView();
        map.fire("dragend");
        expect(regionButton()).toBeNull();

        fireEvent.click(screen.getByRole("button", { name: "현재 검색으로" }));
        map.fire("dragend");
        fireEvent.click(screen.getByRole("button", { name: "새 검색" }));
        await newSearch("강남 술집");
        expect(regionButton()).toBeNull();
      });
    });

    describe("지도 시작 화면 (D-108)", () => {
      const startView = () => {
        const { center, zoom } = map.created[0].options;
        return { lat: center.lat(), lng: center.lng(), zoom };
      };
      const savedView = () => localStorage.getItem("fd.map.view.v1");

      it("저장된 화면에서 시작하고, 멈출 때마다(지도를 만든 뒤 처음 멈춤은 빼고) 그 화면을 저장한다", async () => {
        localStorage.setItem(
          "fd.map.view.v1",
          JSON.stringify({ lat: 36.35, lng: 127.34, zoom: 13 }),
        );
        renderScreen();
        await mapReady();
        expect(startView()).toEqual({ lat: 36.35, lng: 127.34, zoom: 13 });

        const created = map.created[0];
        created.getCenter.mockReturnValue({ lat: () => 37.4, lng: () => 127 });
        created.getZoom.mockReturnValue(16);
        map.fire("idle");
        expect(JSON.parse(savedView()!)).toEqual({
          lat: 36.35,
          lng: 127.34,
          zoom: 13,
        });

        map.fire("idle");
        expect(JSON.parse(savedView()!)).toEqual({
          lat: 37.4,
          lng: 127,
          zoom: 16,
        });
        // 지도 화면 말고는 기기 위치를 담은 키가 없다
        expect(Object.keys(localStorage)).toEqual(["fd.map.view.v1"]);
        // 로그인 세션이 바뀌어도 지우지 않는다
        act(() => stores.current.reset());
        expect(JSON.parse(savedView()!)).toEqual({
          lat: 37.4,
          lng: 127,
          zoom: 16,
        });
      });

      it.each([
        ["저장값이 없으면", undefined],
        ["저장값이 깨졌으면", '{"lat":37.5,"lng":127}'],
      ])("%s 기본 화면(SSAFY 서울캠퍼스)에서 시작한다", async (_, raw) => {
        if (raw) localStorage.setItem("fd.map.view.v1", raw);
        renderScreen();
        await mapReady();

        expect(startView()).toEqual({ lat: 37.5013, lng: 127.0396, zoom: 15 });
      });

      it("기기 저장소가 예외를 던져도 기본 화면으로 그리고 멈춰도 오류가 없다", async () => {
        vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
          throw new Error("blocked");
        });
        const setItem = vi
          .spyOn(Storage.prototype, "setItem")
          .mockImplementation(() => {
            throw new Error("blocked");
          });
        try {
          renderScreen();
          await mapReady();
          expect(startView()).toEqual({
            lat: 37.5013,
            lng: 127.0396,
            zoom: 15,
          });

          map.fire("idle");
          map.fire("idle");
          expect(setItem).toHaveBeenCalled();
          expect(mapState()).toBe("ready");
        } finally {
          vi.restoreAllMocks();
        }
      });
    });

    describe("처음 이동 (D-108)", () => {
      const initialView = () => stores.current.getSnapshot().initialView;

      it("위치가 지도 준비보다 먼저 끝나도 그 위치로 한 번만 옮기고, 다시 마운트하거나 로그인 세션이 바뀌어도 다시 옮기지 않는다", async () => {
        stubLocation({ permission: "granted", position: HERE });
        renderScreen();
        await mapReady();
        await waitFor(() =>
          expect(map.created[0].panTo).toHaveBeenCalledTimes(1),
        );
        expect(map.created[0].morph).not.toHaveBeenCalled();
        expect(initialView()).toBe("applying");
        map.fire("idle");
        await waitFor(() => expect(initialView()).toBe("done"));

        // here가 store에 남은 채 화면을 다시 마운트한다
        cleanup();
        renderScreen();
        await mapReady();
        act(() => stores.current.reset());
        await act(async () => {});
        expect(map.created[1].panTo).not.toHaveBeenCalled();
        expect(stores.current.getSnapshot().location).toEqual({
          status: "ok",
          here: HERE,
        });
      });

      it("위치가 지도 준비보다 늦게 끝나도 한 번만 옮기고 확대 정도는 그대로다", async () => {
        const device = stubLocationLater();
        renderScreen();
        await mapReady();
        await waitFor(() =>
          expect(device.getCurrentPosition).toHaveBeenCalled(),
        );
        expect(map.created[0].panTo).not.toHaveBeenCalled();

        await device.succeed();

        await waitFor(() =>
          expect(map.created[0].panTo).toHaveBeenCalledTimes(1),
        );
        const [coord] = map.created[0].panTo.mock.calls[0];
        expect({ lat: coord.lat(), lng: coord.lng() }).toEqual(HERE);
        expect(map.created[0].morph).not.toHaveBeenCalled();
        map.fire("idle");
        await waitFor(() => expect(initialView()).toBe("done"));
        expect(map.created[0].panTo).toHaveBeenCalledTimes(1);
      });

      // 지도를 없앤 뒤에도 이동이 1.5초 대기로 남으면, 그 뒤에 끝난 이동이 그때의 store(다음 화면, 테스트에서는 다음 테스트)의
      // 처음 이동을 끝내 버린다. 지도를 없애는 순간 기다리던 이동은 그 자리에서 끝난다(PlaceMap 핸들 계약 "지도가 없으면 바로 끝난다")
      it("처음 이동 중에 화면이 없어지면 기다리던 이동이 그 자리에서 끝나 그 화면의 처음 이동을 끝낸다", async () => {
        stubLocation({ permission: "granted", position: HERE });
        renderScreen();
        await waitFor(() =>
          expect(map.created[0].panTo).toHaveBeenCalledTimes(1),
        );
        expect(initialView()).toBe("applying");
        const store = stores.current;

        cleanup();
        await act(async () => {});
        expect(store.getSnapshot().initialView).toBe("done");

        // 다음 화면(테스트)의 store로 바뀐 뒤 옛 지도가 멈춤을 알려도(1.5초 대기가 끝나는 것과 같다) 새 store는 그대로다
        stores.current = createSearchStore();
        map.fire("idle");
        await act(async () => {});
        expect(stores.current.getSnapshot().initialView).toBe("pending");
      });

      it("'내 위치' 이동 중에 화면이 없어지면 기다리던 이동이 그 자리에서 끝나 버튼이 가진 처음 이동을 끝낸다", async () => {
        const device = stubLocationLater();
        renderScreen();
        await mapReady();
        await waitFor(() =>
          expect(device.getCurrentPosition).toHaveBeenCalled(),
        );
        fireEvent.click(screen.getByRole("button", { name: "내 위치" }));
        await device.succeed();
        await waitFor(() => expect(map.created[0].morph).toHaveBeenCalled());
        const store = stores.current;
        expect(store.getSnapshot().initialView).toBe("applying");

        cleanup();
        await act(async () => {});
        expect(store.getSnapshot().initialView).toBe("done");

        stores.current = createSearchStore();
        map.fire("idle");
        await act(async () => {});
        expect(stores.current.getSnapshot().initialView).toBe("pending");
      });

      it("처음 이동 중에 화면을 숨겼다 다시 보여도 다시 옮기지 않는다", async () => {
        const device = stubLocationLater();
        const view = renderHideableScreen();
        await mapReady();
        await waitFor(() =>
          expect(device.getCurrentPosition).toHaveBeenCalled(),
        );
        await device.succeed();
        await waitFor(() =>
          expect(map.created[0].panTo).toHaveBeenCalledTimes(1),
        );

        view.hide();
        view.show();
        await act(async () => {});

        expect(map.created[0].panTo).toHaveBeenCalledTimes(1);
        expect(map.created).toHaveLength(1);
        map.fire("idle");
        await waitFor(() => expect(initialView()).toBe("done"));
      });

      it("위치를 기다리는 동안 '내 위치'를 누르면 위치 조회 1회, 이동 1회(확대 정도 15)이고 처음 이동은 하지 않는다", async () => {
        const device = stubLocationLater();
        renderScreen();
        await mapReady();
        await waitFor(() =>
          expect(device.getCurrentPosition).toHaveBeenCalled(),
        );

        const locationButton = screen.getByRole("button", { name: "내 위치" });
        // 앱을 열 때의 위치 요청에는 색이 바뀌지 않고, 그 조회 중에 누르면 그 순간부터 파란색이다
        expect(locationButton.getAttribute("aria-busy")).toBe("false");
        fireEvent.click(locationButton);
        expect(locationButton.getAttribute("aria-busy")).toBe("true");
        // 누르는 순간 끝나지 않고 버튼이 처음 이동을 가진다(spec 70번)
        expect(initialView()).toBe("applying");
        await device.succeed();

        await waitFor(() =>
          expect(map.created[0].morph).toHaveBeenCalledWith(
            expect.anything(),
            15,
          ),
        );
        expect(map.created[0].morph).toHaveBeenCalledTimes(1);
        expect(map.created[0].panTo).not.toHaveBeenCalled();
        expect(device.getCurrentPosition).toHaveBeenCalledTimes(1);
        // 버튼의 이동이 끝나야 처음 이동이 끝나고, 그 화면으로 처음 홈 요청이 한 번 나간다(AC-64)
        expect(nearbyBodies).toEqual([]);
        map.fire("idle");
        await waitFor(() => expect(initialView()).toBe("done"));
        expect(stores.current.getSnapshot().initialEndedBy).toBe("button");
        await waitFor(() => expect(nearbyBodies).toHaveLength(1));
      });

      it("'내 위치'로 찾는 중에 다른 화면으로 갔다 오면 파란색이 꺼져 있다", async () => {
        const device = stubLocationLater();
        const view = renderHideableScreen();
        await mapReady();
        await waitFor(() =>
          expect(device.getCurrentPosition).toHaveBeenCalled(),
        );
        fireEvent.click(screen.getByRole("button", { name: "내 위치" }));
        expect(
          screen
            .getByRole("button", { name: "내 위치" })
            .getAttribute("aria-busy"),
        ).toBe("true");

        view.hide();
        view.show();
        await act(async () => {});

        expect(
          screen
            .getByRole("button", { name: "내 위치" })
            .getAttribute("aria-busy"),
        ).toBe("false");
      });

      it("처음 이동 뒤 지도가 멈춤을 알리지 않으면 1.5초에 끝나고 그 뒤 처음 홈 요청이 나간다 (AC-64)", async () => {
        const device = stubLocationLater();
        renderScreen();
        await mapReady();
        await waitFor(() =>
          expect(device.getCurrentPosition).toHaveBeenCalled(),
        );
        // waitFor는 vitest의 가짜 타이머를 진행시키지 않으므로 이 구간은 act로만 진행한다
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });

        await device.succeed();
        expect(map.created[0].panTo).toHaveBeenCalledTimes(1);
        expect(initialView()).toBe("applying");

        // idle을 일으키지 않는다
        await act(() => vi.advanceTimersByTimeAsync(1499));
        expect(initialView()).toBe("applying");
        expect(nearbyBodies).toEqual([]);
        await act(() => vi.advanceTimersByTimeAsync(1));
        expect(initialView()).toBe("done");
        vi.useRealTimers();

        await waitFor(() => expect(nearbyBodies).toHaveLength(1));
      });

      it("위치를 기다리는 동안 지도를 끌면 처음 이동이 취소되고, 늦게 온 위치는 내 위치 점으로만 남는다", async () => {
        const device = stubLocationLater();
        renderScreen();
        await mapReady();
        await waitFor(() =>
          expect(device.getCurrentPosition).toHaveBeenCalled(),
        );

        map.fire("dragend");
        expect(initialView()).toBe("done");
        await device.succeed();

        expect(stores.current.getSnapshot().location).toEqual({
          status: "ok",
          here: HERE,
        });
        await act(async () => {});
        expect(map.created[0].panTo).not.toHaveBeenCalled();
        expect(map.created[0].morph).not.toHaveBeenCalled();
      });

      it("위치가 지도 준비보다 늦게 와도 처음 홈 요청은 처음 이동이 끝난 뒤 그 화면으로 1회이고, 그 전에는 skeleton이다 (AC-64)", async () => {
        const device = stubLocationLater();
        renderScreen();
        await mapReady();
        await waitFor(() =>
          expect(device.getCurrentPosition).toHaveBeenCalled(),
        );
        expect(
          screen.getByRole("status", { name: "주변 추천을 불러오는 중" }),
        ).toBeTruthy();
        expect(nearbyBodies).toEqual([]);

        await device.succeed();
        await waitFor(() => expect(map.created[0].panTo).toHaveBeenCalled());
        expect(nearbyBodies).toEqual([]);
        // 지도가 위치로 옮겨져 영역이 바뀐 뒤 멈춘다
        map.view.bounds = AFTER_INITIAL_MOVE;
        map.fire("idle");

        const list = await nearbyList();
        expect(within(list).getByText(/· 0m$/)).toBeTruthy();
        expect(within(list).queryByText(/역삼역/)).toBeNull();
        expect(nearbyBodies).toEqual([{ mapBounds: AFTER_INITIAL_MOVE }]);
      });

      it("처음 이동으로는 결과 화면의 '이 지역에서 검색' 버튼이 나타나지 않는다", async () => {
        const device = stubLocationLater();
        renderScreen();
        await mapReady();
        await waitFor(() =>
          expect(device.getCurrentPosition).toHaveBeenCalled(),
        );
        // 결과가 0곳이라 결과 맞춤 이동이 없어 처음 이동이 남는다(spec 69번)
        fireEvent.change(screen.getByRole("textbox", { name: "장소 검색" }), {
          target: { value: "없는 가게" },
        });
        fireEvent.submit(screen.getByRole("search"));
        await screen.findByText("찾지 못했어요");

        await device.succeed();
        await waitFor(() => expect(map.created[0].panTo).toHaveBeenCalled());
        map.fire("idle");

        expect(regionButton()).toBeNull();
      });
    });

    describe("위치 알림 (D-108)", () => {
      it("처음 조회를 시작한 화면이 숨겨져도 알림은 보이는 화면에서 한 번만 뜬다", async () => {
        const device = stubLocationLater();
        const view = renderHideableScreen();
        await waitFor(() =>
          expect(device.getCurrentPosition).toHaveBeenCalled(),
        );

        view.hide();
        await device.fail();
        expect(screen.queryByText("위치를 확인할 수 없어요")).toBeNull();

        view.show();
        expect(await screen.findByText("위치를 확인할 수 없어요")).toBeTruthy();
        view.hide();
        view.show();
        await act(async () => {});
        expect(screen.getAllByText("위치를 확인할 수 없어요")).toHaveLength(1);
        expect(stores.current.getSnapshot().locationNotice).toBeUndefined();
      });

      it("'내 위치' 버튼 실패 알림은 처음 조회 알림과 따로 누를 때마다 뜬다", async () => {
        stubLocation({ permission: "denied" });
        renderScreen();
        await mapReady();
        expect(await screen.findByText(/위치 권한이 꺼져 있어요/)).toBeTruthy();

        fireEvent.click(screen.getByRole("button", { name: "내 위치" }));

        expect(await screen.findByText("위치를 확인할 수 없어요")).toBeTruthy();
      });
    });

    describe("첫 화면", () => {
      it("위치 권한이 이미 허용이면 열 때 위치를 받아 지도를 그 위치로 옮기고, 그 화면 영역의 주변 카드를 거르지 않고 거리와 함께 보인다 (AC-32, AC-33)", async () => {
        const getCurrentPosition = stubLocation({
          permission: "granted",
          position: { lat: 37.5, lng: 127.03 },
        });
        renderScreen();
        await mapReady();

        await waitFor(() => expect(map.created[0].panTo).toHaveBeenCalled());
        expect(map.created[0].morph).not.toHaveBeenCalled();
        expect(getCurrentPosition).toHaveBeenCalledTimes(1);
        // 지도가 위치로 옮겨져 영역이 바뀐 뒤 멈춘다. 처음 홈 요청은 그 화면의 영역으로 나간다(AC-64)
        map.view.bounds = AFTER_INITIAL_MOVE;
        map.fire("idle");
        const list = await nearbyList();
        expect(within(list).getByText(/· 0m$/)).toBeTruthy();
        // 2km 떨어진 3번도 서버가 준 대로 보인다
        expect(within(list).getByText("장소 3")).toBeTruthy();
        expect(within(list).getByText(/· 2\.0km$/)).toBeTruthy();
        expect(within(list).queryByText(/역삼역/)).toBeNull();
        expect(nearbyBodies).toEqual([{ mapBounds: AFTER_INITIAL_MOVE }]);
      });

      describe('"내 위치" 버튼 (D-100, D-101, D-104)', () => {
        const locationButton = () =>
          screen.getByRole("button", { name: "내 위치" });
        const busy = () => locationButton().getAttribute("aria-busy");
        const iconClass = () =>
          locationButton().querySelector("svg")?.getAttribute("class");

        it("누르면 지도가 그 위치로 이동을 마칠 때까지 파란색이고, 찾는 중에 다시 눌러도 다시 묻지 않는다", async () => {
          const getCurrentPosition = stubLocation({
            position: { lat: 37.5, lng: 127.03 },
          });
          renderScreen();
          await mapReady();
          expect(busy()).toBe("false");
          expect(iconClass()).toContain("text-icon");

          fireEvent.click(locationButton());
          await waitFor(() => expect(map.created[0].morph).toHaveBeenCalled());
          expect(busy()).toBe("true");
          expect(iconClass()).toContain("text-location");
          fireEvent.click(locationButton());
          expect(getCurrentPosition).toHaveBeenCalledTimes(1);
          expect(getCurrentPosition).toHaveBeenCalledWith(
            expect.any(Function),
            expect.any(Function),
            expect.objectContaining({ maximumAge: 300_000 }),
          );

          map.fire("idle");
          await waitFor(() => expect(busy()).toBe("false"));
          expect(iconClass()).toContain("text-icon");
        });

        it("지도가 이미 그 위치이고 확대 정도가 15라 움직이지 않으면 바로 원래 색으로 돌아온다", async () => {
          stubLocation({ position: { lat: 37.5, lng: 127.03 } });
          renderScreen();
          await mapReady();
          map.created[0].getCenter.mockReturnValue({
            lat: () => 37.5,
            lng: () => 127.03,
          });

          fireEvent.click(locationButton());
          await waitFor(() => expect(map.created[0].morph).toHaveBeenCalled());
          await waitFor(() => expect(busy()).toBe("false"));
        });

        it.each([10, 19])(
          "확대 정도가 %i여도 내 위치로 옮기며 15로 맞추고, 그 확대·축소로 '이 지역에서 검색'은 나타나지 않는다",
          async (zoom) => {
            stubLocation({ position: { lat: 37.5, lng: 127.03 } });
            renderScreen();
            await mapReady();
            await newSearch("역삼 카페");
            const created = map.created[0];
            created.getCenter.mockReturnValue({
              lat: () => 37.5,
              lng: () => 127.03,
            });
            created.getZoom.mockReturnValue(zoom);

            fireEvent.click(locationButton());
            await waitFor(() =>
              expect(created.morph).toHaveBeenCalledWith(expect.anything(), 15),
            );
            expect(created.panTo).not.toHaveBeenCalled();
            map.fire("zoom_changed");
            expect(regionButton()).toBeNull();
            expect(busy()).toBe("true");

            map.fire("idle");
            await waitFor(() => expect(busy()).toBe("false"));
            map.fire("zoom_changed");
            expect(regionButton()).toBeTruthy();
          },
        );

        it("위치를 얻지 못하면 알리고 원래 색으로 돌아온다", async () => {
          stubLocation({});
          renderScreen();
          await mapReady();

          fireEvent.click(locationButton());
          expect(
            await screen.findByText("위치를 확인할 수 없어요"),
          ).toBeTruthy();
          expect(busy()).toBe("false");
        });
      });

      it("가운데가 아닌 카드를 누르면 선택하고 지도를 옮기며, 선택된 카드를 누르면 상세로 간다", async () => {
        stubNearbyItems([card(1), card(2)]);
        renderScreen();
        await mapReady();
        const list = await nearbyList();
        const [first, second] = await within(list).findAllByRole("button", {
          pressed: undefined,
        });
        expect(first.getAttribute("aria-pressed")).toBe("true");
        map.created[0].panTo.mockClear();

        fireEvent.click(second);

        expect(second.getAttribute("aria-pressed")).toBe("true");
        expect(first.getAttribute("aria-pressed")).toBe("false");
        expect(map.created[0].panTo).toHaveBeenCalled();
        expect(push).not.toHaveBeenCalled();

        fireEvent.click(second);
        expect(push).toHaveBeenCalledWith("/places/2");
      });

      it("위치를 얻기 전에는 자동완성·결과 카드·주변 카드에 거리가 없고, '내 위치'로 위치를 얻으면 세 곳 모두 거리가 보이며 요청에는 좌표가 없다 (AC-28)", async () => {
        const distance = /(^|· )0m( ·|$)/;
        stubLocation({ permission: "prompt", position: HERE });
        const original = globalThis.fetch;
        vi.stubGlobal(
          "fetch",
          vi.fn<typeof fetch>(async (input, init) =>
            String(input).startsWith("/api/v1/places/suggest")
              ? Response.json([{ type: "PLACE", place: card(1).place }])
              : original(input, init),
          ),
        );
        renderScreen();
        await mapReady();
        const suggestions = async () => {
          const bar = screen.getByRole("textbox", { name: "장소 검색" });
          fireEvent.focus(bar);
          fireEvent.change(bar, { target: { value: "장소" } });
          const list = await screen.findByRole("list", { name: "검색 추천" });
          // 입력한 단어가 강조되어 이름이 여러 요소로 나뉜다
          await waitFor(() => expect(list.textContent).toContain("장소 1"));
          return list;
        };

        expect(within(await nearbyList()).queryByText(distance)).toBeNull();
        expect(within(await suggestions()).queryByText(distance)).toBeNull();
        const results = await newSearch("역삼 카페");
        expect(within(results).queryByText(distance)).toBeNull();
        fireEvent.click(screen.getByRole("button", { name: "새 검색" }));

        fireEvent.click(screen.getByRole("button", { name: "내 위치" }));
        await waitFor(() =>
          expect(stores.current.getSnapshot().location.status).toBe("ok"),
        );

        expect(
          await within(await nearbyList()).findByText(distance),
        ).toBeTruthy();
        expect(within(await suggestions()).getByText(distance)).toBeTruthy();
        const located = await newSearch("역삼 카페");
        expect(within(located).getAllByText(distance).length).toBeGreaterThan(
          0,
        );
        const sent = JSON.stringify([...searchBodies, ...nearbyBodies]);
        expect(sent).not.toContain(String(HERE.lng));
      });

      it("점수가 없는 카드도 핏 점수 없이 서버 순서 그대로 보인다 (AC-33)", async () => {
        const far = { ...card(1), score: undefined };
        const near = {
          ...card(2),
          score: undefined,
          place: { ...card(2).place, lat: 37.5006, lng: 127.0364 },
        };
        stubNearbyItems([far, near]);
        renderScreen();
        await mapReady();
        const list = await nearbyList();

        const names = (await within(list).findAllByText(/^장소 \d$/)).map(
          (node) => node.textContent,
        );
        expect(names).toEqual(["장소 1", "장소 2"]);
        expect(within(list).queryByText("핏 점수")).toBeNull();
      });
    });

    describe("홈 주변 카드 (S15P31A302-204)", () => {
      // 끌거나 버튼으로 옮긴 다른 화면. 0.001도 격자 위라 정규화해도 그대로다
      const AREA_B = {
        swLat: 37.52,
        swLng: 127.06,
        neLat: 37.53,
        neLng: 127.08,
      };
      const MAP_FAILED = MAP_FAILED_TITLE;
      const initialView = () => stores.current.getSnapshot().initialView;
      const homeArea = () => stores.current.getSnapshot().home;
      // 카드 목록의 카드 버튼(선택 여부를 aria-pressed로 알린다)
      const cardButtons = (list: HTMLElement) =>
        within(list)
          .getAllByRole("button")
          .filter((button) => button.hasAttribute("aria-pressed"));

      // 지도에 지금 올라 있는 핀. 핀마다 아이콘 안의 순위 번호를 읽는다
      function stubMapWithPins() {
        const live = new Set<{ options: { icon: { content: string } } }>();
        map = stubNaverMaps({
          Marker: class {
            constructor(readonly options: { icon: { content: string } }) {
              live.add(this);
            }
            setMap(target: unknown) {
              if (target === null) live.delete(this);
            }
            setIcon() {}
            setZIndex() {}
          },
        });
        return {
          count: () => live.size,
          marks: () =>
            [...live].map(
              ({ options }) =>
                options.icon.content.match(/>(\d+)<\/(?:div|span)>/)?.[1],
            ),
        };
      }

      // 크기 알림(ResizeObserver)이 오지 않는다. 그러면 SDK 크기는 홈 영역 확정이 직접 setSize할 때만 바뀐다
      function silenceResize() {
        vi.stubGlobal(
          "ResizeObserver",
          class {
            observe() {}
            disconnect() {}
          },
        );
      }

      // 지도 바깥 div의 크기만 바꾼다(절반 높이였던 지도가 전체 높이가 됨). 덮는 UI 위 끝은 0이라 띠가 없어
      // 보이는 영역은 getBounds() 전체다
      function resizeMapElement(width: number, height: number) {
        const original = HTMLElement.prototype.getBoundingClientRect;
        vi.spyOn(
          HTMLElement.prototype,
          "getBoundingClientRect",
        ).mockImplementation(function (this: HTMLElement) {
          if (!this.hasAttribute("data-map-state")) return original.call(this);
          return {
            top: 0,
            bottom: height,
            left: 0,
            right: width,
            width,
            height,
            x: 0,
            y: 0,
            toJSON() {},
          } as DOMRect;
        });
      }

      // 사용자가 지도를 끌어 그 화면에서 멈춘다
      function dragTo(bounds: typeof AREA_B) {
        map.fire("dragend");
        map.view.bounds = bounds;
        map.fire("idle");
      }

      describe("영역 확정과 홈 진입", () => {
        it("지도가 있으면 주변 카드마다 핀이 하나씩 있고 카드와 같은 순위 번호다 (AC-23)", async () => {
          const pins = stubMapWithPins();
          renderScreen();
          await mapReady();
          const list = await nearbyList();

          expect(cardButtons(list)).toHaveLength(2);
          expect(pins.marks().sort()).toEqual(["1", "2"]);
        });

        it("홈 진입(결과 화면의 절반 지도 → 전체)의 첫 렌더부터 이전 영역의 카드·핀 없이 skeleton이고, 지금 지도 바깥 크기를 SDK에 직접 알린 뒤의 영역으로 한 번 받는다 (AC-69, AC-70)", async () => {
          const pins = stubMapWithPins();
          // 크기 알림(ResizeObserver)은 오지 않는다. 확정이 직접 setSize해야 영역이 AREA_B가 된다
          silenceResize();
          renderScreen();
          await mapReady();
          await nearbyList();
          await newSearch("역삼 카페");
          resizeMapElement(400, 800);
          map.view.afterSize = AREA_B;

          fireEvent.click(screen.getByRole("button", { name: "새 검색" }));

          expect(skeleton()).toBeTruthy();
          expect(
            screen.queryByRole("region", { name: "주변 추천 장소" }),
          ).toBeNull();
          expect(pins.count()).toBe(0);
          expect(map.created[0].setSize).toHaveBeenLastCalledWith(
            expect.objectContaining({ width: 400, height: 800 }),
          );

          await nearbyList();
          expect(nearbyBodies).toEqual([
            { mapBounds: BOUNDS },
            { mapBounds: AREA_B },
          ]);
          expect(homeArea().bounds).toEqual(AREA_B);
        });

        it("처음 홈 요청도 지금 지도 바깥 크기를 SDK에 직접 알린 뒤의 영역으로 한 번 받는다 (AC-70)", async () => {
          silenceResize();
          resizeMapElement(400, 800);
          map.view.afterSize = AREA_B;
          renderScreen();
          await mapReady();

          await nearbyList();
          expect(map.created[0].setSize).toHaveBeenLastCalledWith(
            expect.objectContaining({ width: 400, height: 800 }),
          );
          expect(nearbyBodies).toEqual([{ mapBounds: AREA_B }]);
        });

        it("영역을 읽기 전 SDK에 크기를 알리다 던지면(지도 실패) 요청하지 않고 지도 실패 안내를 보인다 (AC-70)", async () => {
          silenceResize();
          renderScreen();
          await mapReady();
          await nearbyList();
          await newSearch("역삼 카페");
          map.created[0].setSize.mockImplementation(() => {
            throw new Error("지도 실패");
          });

          fireEvent.click(screen.getByRole("button", { name: "새 검색" }));

          expect(await screen.findByText(MAP_FAILED)).toBeTruthy();
          await act(async () => {});
          expect(nearbyBodies).toHaveLength(1);
        });

        it("상세에 다녀오면 skeleton 없이 영역·선택한 카드·지도가 그대로이고 요청이 없다 (AC-67)", async () => {
          const view = renderHideableScreen();
          await mapReady();
          const list = await nearbyList();
          fireEvent.click(cardButtons(list)[1]);

          view.hide();
          view.show();

          expect(skeleton()).toBeNull();
          const shown = screen.getByRole("region", { name: "주변 추천 장소" });
          expect(cardButtons(shown)[1].getAttribute("aria-pressed")).toBe(
            "true",
          );
          await act(async () => {});
          expect(nearbyBodies).toHaveLength(1);
          expect(map.created).toHaveLength(1);
          expect(homeArea().bounds).toEqual(BOUNDS);
        });

        it("받은 지 10분 안에 상세에서 돌아오면 요청이 없고, 10분이 지나면 카드를 그린 채 같은 영역으로 다시 받는다 (AC-67)", async () => {
          vi.useFakeTimers({ toFake: ["Date"] });
          const view = renderHideableScreen();
          await mapReady();
          await nearbyList();

          view.hide();
          vi.setSystemTime(Date.now() + 600_000 - 1_000);
          view.show();
          await act(async () => {});
          expect(nearbyBodies).toHaveLength(1);

          view.hide();
          vi.setSystemTime(Date.now() + 2_000);
          view.show();
          expect(skeleton()).toBeNull();
          expect(
            screen.getByRole("region", { name: "주변 추천 장소" }),
          ).toBeTruthy();
          await waitFor(() => expect(nearbyBodies).toHaveLength(2));
          expect(nearbyBodies[1]).toEqual(nearbyBodies[0]);
        });

        it("숨은 사이 cache가 gc됐으면 영역과 선택은 그대로 두고 skeleton을 보이며 같은 영역으로 다시 받는다 (AC-67)", async () => {
          const view = renderHideableScreen();
          await mapReady();
          const list = await nearbyList();
          fireEvent.click(cardButtons(list)[1]);

          view.hide();
          // gcTime(10분, place-queries 테스트)이 지나 cache가 지워진 것과 같다
          clients[0].removeQueries({ queryKey: ["places", "nearby"] });
          view.show();

          expect(skeleton()).toBeTruthy();
          const shown = await nearbyList();
          expect(cardButtons(shown)[1].getAttribute("aria-pressed")).toBe(
            "true",
          );
          expect(nearbyBodies).toEqual([
            { mapBounds: BOUNDS },
            { mapBounds: BOUNDS },
          ]);
        });

        it("홈에서 보낸 검색을 취소해 돌아오면 홈 진입이 아니라 카드가 그대로이고 요청이 없다 (AC-67)", async () => {
          renderScreen();
          await mapReady();
          await nearbyList();
          const entry = homeArea().entry;
          holdSearches();
          vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
          fireEvent.change(screen.getByRole("textbox", { name: "장소 검색" }), {
            target: { value: "역삼 카페" },
          });
          fireEvent.submit(screen.getByRole("search"));
          await act(() => vi.advanceTimersByTimeAsync(SEARCH_SLOW_MS));
          vi.useRealTimers();

          fireEvent.click(screen.getByRole("button", { name: "검색 취소" }));
          await screen.findByRole("textbox", { name: "장소 검색" });

          expect(skeleton()).toBeNull();
          expect(
            screen.getByRole("region", { name: "주변 추천 장소" }),
          ).toBeTruthy();
          await act(async () => {});
          expect(nearbyBodies).toHaveLength(1);
          expect(homeArea().entry).toBe(entry);
        });

        it("홈에서 보낸 검색이 실패해 '새 검색'으로 돌아오면 홈 진입이 아니라 카드가 그대로이고 요청이 없다 (AC-67)", async () => {
          const original = globalThis.fetch;
          vi.stubGlobal(
            "fetch",
            vi.fn<typeof fetch>((input, init) =>
              String(input) === "/api/v1/places/search"
                ? Promise.resolve(
                    Response.json({ status: 400 }, { status: 400 }),
                  )
                : original(input, init),
            ),
          );
          renderScreen();
          await mapReady();
          await nearbyList();
          const entry = homeArea().entry;
          fireEvent.change(screen.getByRole("textbox", { name: "장소 검색" }), {
            target: { value: "역삼 카페" },
          });
          fireEvent.submit(screen.getByRole("search"));
          await screen.findByText("추천을 불러오지 못했어요");

          fireEvent.click(screen.getByRole("button", { name: "새 검색" }));

          expect(skeleton()).toBeNull();
          expect(
            screen.getByRole("region", { name: "주변 추천 장소" }),
          ).toBeTruthy();
          await act(async () => {});
          expect(nearbyBodies).toHaveLength(1);
          expect(homeArea().entry).toBe(entry);
        });
      });

      describe("홈에는 '이 지역에서 검색'이 없다 (AC-71)", () => {
        it("카드를 넘기고 끌거나 확대·축소해 멈춘 뒤에도 버튼이 없고, 카드·선택·홈 영역이 그대로이며 nearby 요청이 없다", async () => {
          const pins = stubMapWithPins();
          renderScreen();
          await mapReady();
          const list = await nearbyList();
          const pinCount = pins.count();

          fireEvent.click(cardButtons(list)[1]);
          map.view.bounds = AREA_B;
          map.fire("idle");
          expect(regionButton()).toBeNull();

          dragTo(AREA_B);
          expect(regionButton()).toBeNull();

          map.fire("zoom_changed");
          map.view.bounds = { ...AREA_B, swLat: AREA_B.swLat + 0.01 };
          map.fire("idle");
          expect(regionButton()).toBeNull();

          expect(skeleton()).toBeNull();
          expect(pins.count()).toBe(pinCount);
          expect(cardButtons(list)[1].getAttribute("aria-pressed")).toBe(
            "true",
          );
          expect(homeArea().bounds).toEqual(BOUNDS);
          await act(async () => {});
          expect(nearbyBodies).toEqual([{ mapBounds: BOUNDS }]);
        });

        it("'내 위치'로 지도가 실제로 옮겨져 영역이 달라져도 버튼이 없고, 카드는 그대로이며 nearby 요청이 없다 (AC-45)", async () => {
          stubLocation({ permission: "prompt", position: HERE });
          renderScreen();
          await mapReady();
          const list = await nearbyList();

          fireEvent.click(screen.getByRole("button", { name: "내 위치" }));
          await waitFor(() => expect(map.created[0].morph).toHaveBeenCalled());
          map.view.bounds = AREA_B;
          map.fire("idle");

          expect(regionButton()).toBeNull();
          expect(skeleton()).toBeNull();
          expect(screen.getByRole("region", { name: "주변 추천 장소" })).toBe(
            list,
          );
          expect(homeArea().bounds).toEqual(BOUNDS);
          await act(async () => {});
          expect(nearbyBodies).toEqual([{ mapBounds: BOUNDS }]);
        });
      });

      describe("빈 상태와 지도 실패 (AC-72, AC-73)", () => {
        function stubNearbyResponse(response: PlaceSearchResponse) {
          const original = globalThis.fetch;
          vi.stubGlobal(
            "fetch",
            vi.fn<typeof fetch>(async (input, init) => {
              if (String(input) !== "/api/v1/places/nearby") {
                return original(input, init);
              }
              await original(input, init);
              return Response.json(response);
            }),
          );
        }

        it("영역 안에 장소가 없고 emptyReason이 있으면 카드 자리에 이유와 제안을 보인다 (AC-72)", async () => {
          stubNearbyResponse({
            conditions: {},
            nearby: true,
            totalCount: 0,
            items: [],
            emptyReason: {
              cause: "이 지역에는 아직 장소가 없어요",
              suggestion: "지도를 옮겨 보세요",
            },
          });
          renderScreen();
          await mapReady();

          expect(
            await screen.findByText("이 지역에는 아직 장소가 없어요"),
          ).toBeTruthy();
          expect(screen.getByText("지도를 옮겨 보세요")).toBeTruthy();
          expect(skeleton()).toBeNull();
          expect(
            screen.queryByRole("region", { name: "주변 추천 장소" }),
          ).toBeNull();
        });

        it("emptyReason 없는 0곳이면 카드 자리에 아무것도 그리지 않는다 (AC-72)", async () => {
          stubNearbyResponse({
            conditions: {},
            nearby: true,
            totalCount: 0,
            items: [],
          });
          renderScreen();
          await mapReady();
          await waitFor(() => expect(nearbyBodies).toHaveLength(1));
          await waitFor(() => expect(skeleton()).toBeNull());

          expect(
            screen.queryByRole("region", { name: "주변 추천 장소" }),
          ).toBeNull();
          expect(screen.queryByRole("alert")).toBeNull();
          expect(
            screen.queryByText("주변 추천을 불러오지 못했어요"),
          ).toBeNull();
        });

        it("정규화한 영역이 유효하지 않으면 요청 없이 지도 실패 안내를 보이고, 다음 멈춤에서 다시 잰 영역이 유효하면 그 영역으로 받는다 (AC-65, AC-73)", async () => {
          // 경도의 SW가 NE보다 크다
          map.view.bounds = {
            swLat: 37.49,
            swLng: 127.05,
            neLat: 37.51,
            neLng: 127.02,
          };
          renderScreen();
          await mapReady();

          expect(await screen.findByText(MAP_FAILED)).toBeTruthy();
          expect(skeleton()).toBeNull();
          expect(nearbyBodies).toEqual([]);

          dragTo(BOUNDS);

          await nearbyList();
          expect(screen.queryByText(MAP_FAILED)).toBeNull();
          expect(nearbyBodies).toEqual([{ mapBounds: BOUNDS }]);
        });
        it("정규화한 영역만 유효하지 않은 동안의 새 검색은 64번대로 보내는 순간의 보이는 영역을 담는다 (AC-73)", async () => {
          const invalid = {
            swLat: 37.49,
            swLng: 127.05,
            neLat: 37.51,
            neLng: 127.02,
          };
          map.view.bounds = invalid;
          renderScreen();
          await mapReady();
          expect(await screen.findByText(MAP_FAILED)).toBeTruthy();

          await newSearch("역삼 카페");

          expect(searchBodies).toEqual([
            { query: "역삼 카페", mapBounds: invalid },
          ]);
          expect(nearbyBodies).toEqual([]);
        });
      });

      describe("처음 홈 요청 (AC-64)", () => {
        it("처음 홈 요청 전의 홈 진입은 따로 요청하지 않고, 처음 이동이 끝난 뒤 그때 화면으로 한 번 나간다", async () => {
          const device = stubLocationLater();
          renderScreen();
          await mapReady();
          await waitFor(() =>
            expect(device.getCurrentPosition).toHaveBeenCalled(),
          );
          // 결과가 0곳이라 결과 맞춤 이동이 없어 처음 이동이 남은 채 홈으로 돌아온다(spec 70번의 예)
          fireEvent.change(screen.getByRole("textbox", { name: "장소 검색" }), {
            target: { value: "없는 가게" },
          });
          fireEvent.submit(screen.getByRole("search"));
          await screen.findByText("찾지 못했어요");

          fireEvent.click(screen.getByRole("button", { name: "새 검색" }));
          await screen.findByRole("textbox", { name: "장소 검색" });
          await act(async () => {});
          expect(initialView()).not.toBe("done");
          expect(skeleton()).toBeTruthy();
          expect(nearbyBodies).toEqual([]);

          await device.succeed();
          await waitFor(() => expect(map.created[0].panTo).toHaveBeenCalled());
          map.view.bounds = AREA_B;
          map.fire("idle");

          await nearbyList();
          await act(async () => {});
          expect(nearbyBodies).toEqual([{ mapBounds: AREA_B }]);
        });

        it("위치 조회가 10초 안에 끝나지 않으면 timeout 뒤에 그때 화면의 영역으로 한 번 나간다", async () => {
          vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
          const getCurrentPosition = vi.fn(
            (
              _: PositionCallback,
              error: PositionErrorCallback,
              options?: PositionOptions,
            ) => {
              // 브라우저가 timeout만큼 기다린 뒤 TIMEOUT으로 끝낸다
              setTimeout(
                () =>
                  error({ code: 3, TIMEOUT: 3 } as GeolocationPositionError),
                options?.timeout,
              );
            },
          );
          vi.stubGlobal("navigator", {
            geolocation: { getCurrentPosition },
            permissions: { query: async () => ({ state: "granted" }) },
          });
          renderScreen();
          await act(() => vi.advanceTimersByTimeAsync(0));
          expect(mapState()).toBe("ready");
          expect(getCurrentPosition).toHaveBeenCalledTimes(1);

          await act(() => vi.advanceTimersByTimeAsync(9_999));
          expect(nearbyBodies).toEqual([]);
          expect(skeleton()).toBeTruthy();
          await act(() => vi.advanceTimersByTimeAsync(1));
          vi.useRealTimers();

          await waitFor(() =>
            expect(nearbyBodies).toEqual([{ mapBounds: BOUNDS }]),
          );
        });

        it("처음 이동이 끝나기 전에 지도를 끌면 지도가 멈춘 뒤의 화면으로 한 번 나간다", async () => {
          const device = stubLocationLater();
          renderScreen();
          await mapReady();
          await waitFor(() =>
            expect(device.getCurrentPosition).toHaveBeenCalled(),
          );

          map.fire("dragend");
          expect(initialView()).toBe("done");
          await act(async () => {});
          expect(nearbyBodies).toEqual([]);
          map.view.bounds = AREA_B;
          map.fire("idle");

          await waitFor(() =>
            expect(nearbyBodies).toEqual([{ mapBounds: AREA_B }]),
          );
        });

        it("처음 panTo 중에 '내 위치'를 누르면 그 이동이 끝난 화면으로 한 번 나간다", async () => {
          const device = stubLocationLater();
          renderScreen();
          await mapReady();
          await waitFor(() =>
            expect(device.getCurrentPosition).toHaveBeenCalled(),
          );
          await device.succeed();
          expect(map.created[0].panTo).toHaveBeenCalledTimes(1);
          expect(initialView()).toBe("applying");

          fireEvent.click(screen.getByRole("button", { name: "내 위치" }));
          expect(stores.current.getSnapshot().initialOwnedByButton).toBe(true);
          // 버튼은 위치를 새로 묻는다
          await waitFor(() =>
            expect(device.getCurrentPosition).toHaveBeenCalledTimes(2),
          );
          await device.succeed();
          await waitFor(() => expect(map.created[0].morph).toHaveBeenCalled());
          expect(nearbyBodies).toEqual([]);
          map.view.bounds = AREA_B;
          map.fire("idle");

          await waitFor(() =>
            expect(nearbyBodies).toEqual([{ mapBounds: AREA_B }]),
          );
          expect(stores.current.getSnapshot().initialEndedBy).toBe("button");
        });

        it("위치를 기다리는 동안 누른 '내 위치'가 위치를 얻지 못하면 그때 화면으로 한 번 나간다", async () => {
          const device = stubLocationLater();
          renderScreen();
          await mapReady();
          await waitFor(() =>
            expect(device.getCurrentPosition).toHaveBeenCalled(),
          );

          fireEvent.click(screen.getByRole("button", { name: "내 위치" }));
          await device.fail();

          await waitFor(() =>
            expect(nearbyBodies).toEqual([{ mapBounds: BOUNDS }]),
          );
          expect(stores.current.getSnapshot().initialEndedBy).toBe("button");
        });

        it("권한 확인 중에 '내 위치'를 누르면 버튼 이동이 끝나기 전에는 나가지 않고, 끝난 뒤 한 번 나간다", async () => {
          const pending: PositionCallback[] = [];
          vi.stubGlobal("navigator", {
            geolocation: {
              getCurrentPosition: (success: PositionCallback) =>
                pending.push(success),
            },
            // 권한 확인이 끝나지 않는다
            permissions: { query: () => new Promise(() => {}) },
          });
          renderScreen();
          await mapReady();

          fireEvent.click(screen.getByRole("button", { name: "내 위치" }));
          await waitFor(() => expect(pending).toHaveLength(1));
          await act(async () =>
            pending[0]({
              coords: { latitude: HERE.lat, longitude: HERE.lng },
            } as GeolocationPosition),
          );
          await waitFor(() => expect(map.created[0].morph).toHaveBeenCalled());
          await act(async () => {});
          expect(nearbyBodies).toEqual([]);

          map.fire("idle");

          await waitFor(() => expect(nearbyBodies).toHaveLength(1));
        });

        it("'내 위치'가 처음 이동을 가진 동안 결과 맞춤 이동이 시작되면 처음 이동이 끝난다", async () => {
          const device = stubLocationLater();
          renderScreen();
          await mapReady();
          await waitFor(() =>
            expect(device.getCurrentPosition).toHaveBeenCalled(),
          );
          fireEvent.click(screen.getByRole("button", { name: "내 위치" }));
          expect(stores.current.getSnapshot().initialOwnedByButton).toBe(true);

          await newSearch("역삼 카페");

          expect(map.created[0].fitBounds).toHaveBeenCalledTimes(1);
          expect(initialView()).toBe("done");
          expect(stores.current.getSnapshot().initialEndedBy).toBe("fit");
        });
      });
    });

    it("화면 크기가 바뀌면 바깥 지도 영역의 크기로 setSize를 부른다", async () => {
      const observed: { target: Element; callback: ResizeObserverCallback }[] =
        [];
      vi.stubGlobal(
        "ResizeObserver",
        class {
          constructor(private readonly callback: ResizeObserverCallback) {}
          observe(target: Element) {
            observed.push({ target, callback: this.callback });
          }
          disconnect() {}
        },
      );
      const { created } = stubNaverMaps();
      renderScreen();
      await mapReady();

      // SDK는 안쪽 div에 px 크기를 박으므로 CSS로 크기가 정해지는 바깥을 봐야 한다
      const wrapper = document.querySelector("[data-map-state]");
      const mapObserved = observed.filter(({ target }) =>
        wrapper?.contains(target),
      );
      expect(mapObserved.map(({ target }) => target)).toEqual([wrapper]);
      mapObserved[0].callback(
        [{ contentRect: { width: 390, height: 422 } } as ResizeObserverEntry],
        {} as ResizeObserver,
      );
      expect(created[0].setSize).toHaveBeenCalledWith({
        width: 390,
        height: 422,
      });
    });
  });

  describe("지도를 쓸 수 없을 때", () => {
    it("지도가 없으면 새 검색은 mapBounds 없이 그대로 나간다 (AC-53)", async () => {
      renderScreen();
      await waitFor(() => expect(mapState()).toBe("empty"));

      await newSearch("역삼 카페");
      await followUp("더 조용하게");

      expect(searchBodies).toEqual([
        { query: "역삼 카페" },
        { query: "더 조용하게", previousConditions: { area: "역삼" } },
      ]);
    });

    it("지도가 없으면 처음 이동을 끝내고, 늦게 온 위치는 store에만 둔다", async () => {
      const device = stubLocationLater();
      renderScreen();
      await waitFor(() => expect(mapState()).toBe("empty"));
      await waitFor(() =>
        expect(stores.current.getSnapshot().initialView).toBe("done"),
      );
      await waitFor(() => expect(device.getCurrentPosition).toHaveBeenCalled());

      await device.succeed();

      expect(stores.current.getSnapshot().location).toEqual({
        status: "ok",
        here: HERE,
      });
    });

    it("지도 SDK가 핀을 만들다 던지면(인증 실패 직후) 지도 영역이 비고 카드 목록은 동작한다", async () => {
      config.value = { env: "dev", naverMapClientId: "key" };
      // SDK가 new로 부르므로 생성자로 쓸 수 있는 함수여야 한다
      const marker = vi.fn(function () {
        throw new TypeError(
          "Cannot read properties of null (reading 'LatLng')",
        );
      });
      stubNaverMaps({ Marker: marker });
      renderScreen();
      await mapReady();

      const list = await newSearch("역삼 카페");

      expect(marker).toHaveBeenCalled();
      await waitFor(() => expect(mapState()).toBe("empty"));
      expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    });

    it.each([
      ["지도 키가 없으면", { env: "dev" }],
      ["/config.json 요청이 실패하면", undefined],
    ])(
      "%s 지도 영역이 비고 카드 목록과 후속 조건이 동작한다",
      async (_, value) => {
        config.value = value;
        renderScreen();

        await waitFor(() => expect(mapState()).toBe("empty"));
        const list = await newSearch("역삼 카페");
        expect(within(list).getAllByRole("listitem")).toHaveLength(2);
        expect(
          screen.queryByRole("button", { name: "이 지역에서 검색" }),
        ).toBeNull();

        await followUp("더 조용하게");
        expect(screen.getByText("요청하신 조건을 반영했어요")).toBeTruthy();
      },
    );

    it.each([
      ["지도 키가 없으면", { env: "dev" }],
      ["/config.json 요청이 실패하면", undefined],
    ])(
      "%s 홈은 skeleton에 머물지 않고 카드 자리에 지도 실패 안내를 보이며, 다시 시도가 없고 nearby 요청이 없다 (AC-73)",
      async (_, value) => {
        config.value = value;
        renderScreen();

        expect(await screen.findByText(MAP_FAILED_TITLE)).toBeTruthy();
        expect(screen.getByText(MAP_FAILED_DESCRIPTION)).toBeTruthy();
        expect(skeleton()).toBeNull();
        expect(screen.queryByRole("button", { name: "다시 시도" })).toBeNull();
        expect(nearbyBodies).toEqual([]);
      },
    );

    it("카드가 보인 뒤 지도 인증 실패가 늦게 오면 카드 대신 지도 실패 안내를 보이고 다시 받지 않는다 (AC-73)", async () => {
      config.value = { env: "dev", naverMapClientId: "key" };
      await renderInNewPageSession();
      const script = await waitFor(() => {
        const element = document.querySelector<HTMLScriptElement>(
          'script[src*="oapi.map.naver.com"]',
        );
        expect(element).toBeTruthy();
        return element!;
      });
      stubNaverMaps();
      act(() => script.onload?.(new Event("load")));
      await nearbyList();

      act(() => window.navermap_authFailure?.());

      expect(await screen.findByText(MAP_FAILED_TITLE)).toBeTruthy();
      expect(
        screen.queryByRole("region", { name: "주변 추천 장소" }),
      ).toBeNull();
      expect(screen.queryByRole("button", { name: "다시 시도" })).toBeNull();
      await act(async () => {});
      expect(nearbyBodies).toHaveLength(1);
    });

    it("지도 인증이 실패하면(navermap_authFailure) 지도 영역이 비고 카드 목록은 동작한다", async () => {
      config.value = { env: "dev", naverMapClientId: "wrong-key" };
      await renderInNewPageSession();

      await waitFor(() =>
        expect(
          document.querySelector('script[src*="oapi.map.naver.com"]'),
        ).toBeTruthy(),
      );
      const script = document.querySelector<HTMLScriptElement>(
        'script[src*="oapi.map.naver.com"]',
      )!;
      expect(script.src).toBe(
        "https://oapi.map.naver.com/openapi/v3/maps.js?ncpKeyId=wrong-key",
      );
      window.navermap_authFailure?.();

      await waitFor(() => expect(mapState()).toBe("empty"));
      // 홈은 카드 자리에 지도 실패 안내를 보이고 주변 카드를 받지 않는다(AC-73)
      expect(await screen.findByText(MAP_FAILED_TITLE)).toBeTruthy();
      expect(nearbyBodies).toEqual([]);
      const list = await newSearch("역삼 카페");
      expect(within(list).getAllByRole("listitem")).toHaveLength(2);
    });
  });

  it("결과가 있으면 후속 입력창이 보이고, 기준 요청의 conditions를 previousConditions로 보낸다", async () => {
    renderScreen();
    await newSearch("역삼 카페");

    expect(screen.queryByRole("textbox", { name: "장소 검색" })).toBeNull();
    await followUp("더 조용하게");

    expect(searchBodies[1]).toEqual({
      query: "더 조용하게",
      previousConditions: { area: "역삼" },
    });
    expect(screen.getByText("추가 조건 · 더 조용하게")).toBeTruthy();
  });

  it("후속 조건 결과의 제목은 첫 요청 문장이고, 후속 입력은 칩으로만 보인다", async () => {
    renderScreen();
    await newSearch("역삼 카페");
    await followUp("더 조용하게");
    await followUp("주차 되는 곳");

    expect(screen.getByRole("heading", { name: "“역삼 카페”" })).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "“주차 되는 곳”" }),
    ).toBeNull();
    expect(screen.getByText("추가 조건 · 더 조용하게")).toBeTruthy();
  });

  it("후속 조건을 받는 동안에도 제목은 첫 요청 문장이다", async () => {
    renderScreen();
    await newSearch("역삼 카페");
    // 후속 조건 응답은 오지 않는다
    const original = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>((input, init) =>
        String(init?.body).includes("previousConditions")
          ? new Promise(() => {})
          : original(input, init),
      ),
    );

    sendFollowUp("더 조용하게");

    expect(await screen.findByText("요청을 이해하는 중")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "“역삼 카페”" })).toBeTruthy();
  });

  it("전체 패널에는 '지도 보기'가 없고 손잡이로 중간 높이로 돌아간다", async () => {
    renderScreen();
    await newSearch("역삼 카페");

    fireEvent.click(screen.getByRole("button", { name: "패널 펼치기" }));

    expect(screen.queryByRole("button", { name: "지도 보기" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "패널 줄이기" }));
    expect(screen.getByRole("button", { name: "패널 펼치기" })).toBeTruthy();
  });

  it("'새 검색'은 결과와 조건을 비우고 위쪽 검색창으로 돌아가며 다음 요청에 previousConditions가 없다", async () => {
    renderScreen();
    await newSearch("역삼 카페");

    fireEvent.click(screen.getByRole("button", { name: "새 검색" }));
    expect(screen.queryByRole("list", { name: "추천 장소" })).toBeNull();
    await newSearch("강남 술집");

    expect(searchBodies.at(-1)).toEqual({ query: "강남 술집" });
  });

  it("요청 기록은 결과 패널 안에 펼치고 다시 누르면 결과 목록으로 돌아온다", async () => {
    renderScreen();
    await newSearch("역삼 카페");
    await followUp("더 조용하게");

    const history = await openHistory();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("list", { name: "추천 장소" })).toBeNull();
    expect(screen.getByRole("textbox", { name: "후속 조건" })).toBeTruthy();
    expect(within(history).getByText("역삼 카페")).toBeTruthy();
    expect(within(history).getByText("보는 중")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "요청 기록" })
        .getAttribute("aria-expanded"),
    ).toBe("true");

    fireEvent.click(screen.getByRole("button", { name: "요청 기록" }));
    expect(screen.queryByRole("list", { name: "요청 기록" })).toBeNull();
    expect(screen.getByRole("list", { name: "추천 장소" })).toBeTruthy();
  });

  it("'결과 보기'는 네트워크 없이 그때 결과를 과거 결과 화면으로 보이고 지금 보는 요청은 그대로다", async () => {
    renderScreen();
    await newSearch("역삼 카페");
    await followUp("더 조용하게");
    const requestCount = searchBodies.length;
    const viewing = stores.current.getSnapshot().viewingId;

    const history = await openHistory();
    fireEvent.click(within(history).getByRole("button", { name: "결과 보기" }));

    const past = await pastView();
    expect(within(past).getByText(/결과 · “역삼 카페”$/)).toBeTruthy();
    expect(
      within(
        within(past).getByRole("list", { name: "추천 장소" }),
      ).getAllByRole("listitem"),
    ).toHaveLength(2);
    expect(screen.queryByRole("textbox", { name: "후속 조건" })).toBeNull();
    expect(screen.queryByRole("button", { name: "새 검색" })).toBeNull();
    expect(searchBodies).toHaveLength(requestCount);
    expect(stores.current.getSnapshot().viewingId).toBe(viewing);

    fireEvent.click(screen.getByRole("button", { name: "현재 검색으로" }));
    expect(await screen.findByRole("list", { name: "요청 기록" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "과거 결과" })).toBeNull();
  });

  it("과거 결과 화면의 지도 위에는 '현재 검색으로'만 있다", async () => {
    renderScreen();
    await newSearch("역삼 카페");
    await followUp("더 조용하게");

    const history = await openHistory();
    fireEvent.click(within(history).getByRole("button", { name: "결과 보기" }));
    await pastView();

    expect(screen.queryByRole("button", { name: "저장한 장소" })).toBeNull();
    expect(screen.queryByRole("button", { name: "내 정보" })).toBeNull();
    expect(screen.getByRole("button", { name: "현재 검색으로" })).toBeTruthy();
  });

  it("'이 조건으로 다시 검색'은 같은 요청 본문을 보내 thread 끝에 쌓고 원래 요청은 그대로 둔다", async () => {
    renderScreen();
    await newSearch("역삼 카페");
    await followUp("더 조용하게");
    await followUp("카페 말고 식당");

    const history = await openHistory();
    // 지금 보는 항목(셋째)에는 버튼이 없어, 둘째 "더 조용하게" 항목의 버튼이다
    fireEvent.click(
      within(history).getAllByRole("button", { name: "결과 보기" })[1],
    );
    const past = await pastView();
    fireEvent.click(
      within(past).getByRole("button", { name: "이 조건으로 다시 검색" }),
    );

    await waitFor(() =>
      expect(stores.current.getSnapshot().entries).toHaveLength(4),
    );
    expect(searchBodies.at(-1)).toEqual(searchBodies[1]);
    const [first, second, , repeated] = stores.current.getSnapshot().entries;
    expect(repeated).toMatchObject({
      kind: "followUp",
      baseId: first.id,
      sentence: "더 조용하게",
    });
    expect(stores.current.getSnapshot().viewingId).toBe(repeated.id);
    expect(second.sentence).toBe("더 조용하게");
    expect(screen.queryByRole("region", { name: "과거 결과" })).toBeNull();
  });

  it("'여기서 이어 검색'은 그 요청을 지금 보는 요청으로 바꾸고 후속 입력창에 초점을 두며, 후속은 그 요청의 conditions를 보낸다", async () => {
    renderScreen();
    await newSearch("역삼 카페");
    await followUp("더 조용하게");

    const history = await openHistory();
    fireEvent.click(
      within(history).getByRole("button", { name: "여기서 이어 검색" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "“역삼 카페”" })).toBeTruthy(),
    );
    expect(screen.queryByRole("list", { name: "요청 기록" })).toBeNull();
    await waitFor(() =>
      expect(document.activeElement).toBe(
        screen.getByRole("textbox", { name: "후속 조건" }),
      ),
    );
    await followUp("카페 말고 식당");

    expect(searchBodies.at(-1)).toEqual({
      query: "카페 말고 식당",
      previousConditions: { area: "역삼" },
    });
  });

  it("카드를 처음 누르면 선택하고, 선택된 카드를 다시 누르면 상세로 간다", async () => {
    renderScreen();
    const list = await newSearch("역삼 카페");
    const [first, second] = within(list).getAllByRole("button");

    fireEvent.click(first);
    expect(first.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(second);
    expect(first.getAttribute("aria-pressed")).toBe("false");
    expect(second.getAttribute("aria-pressed")).toBe("true");
    expect(push).not.toHaveBeenCalled();

    fireEvent.click(second);
    expect(push).toHaveBeenCalledWith("/places/2");
  });

  describe("근처 검색", () => {
    let map: ReturnType<typeof stubNaverMaps>;
    // 홈 주변 카드는 지도 영역으로 받으므로 지도가 있어야 한다(지도가 없으면 실패 안내, spec 75번)
    beforeEach(() => {
      config.value = { env: "dev", naverMapClientId: "key" };
      map = stubNaverMaps();
    });

    // 권한은 허용이라 앱을 열 때 위치를 받는다. denied면 위치를 얻지 못한다
    function stubGeolocation(result: { lat: number; lng: number } | "denied") {
      vi.stubGlobal("navigator", {
        permissions: { query: async () => ({ state: "granted" }) },
        geolocation: {
          getCurrentPosition: (
            success: PositionCallback,
            error: PositionErrorCallback,
          ) =>
            result === "denied"
              ? error({ code: 1 } as GeolocationPositionError)
              : success({
                  coords: { latitude: result.lat, longitude: result.lng },
                } as GeolocationPosition),
        },
      });
    }

    const rankedNames = (list: HTMLElement) =>
      within(list)
        .getAllByRole("listitem")
        .map((item) => within(item).getByText(/^장소 \d$/).textContent);

    it("위치를 얻어도 근처 응답을 거리로 거르지 않고 서버 순서와 개수 그대로 거리와 함께 보인다(AC-52, AC-16)", async () => {
      stubGeolocation({ lat: 37.5, lng: 127.03 });
      renderScreen();
      // 처음 이동(panTo)이 멈출 때까지 기다린다
      await waitFor(() => expect(map.created[0]?.panTo).toHaveBeenCalled());
      map.fire("idle");
      await waitFor(() =>
        expect(stores.current.getSnapshot().initialView).toBe("done"),
      );

      const list = await newSearch("근처 카페");

      // 3번은 약 2km 떨어져 있어도 그대로 보인다
      expect(rankedNames(list)).toEqual(["장소 1", "장소 3"]);
      expect(within(list).getByText(/· 0m$/)).toBeTruthy();
      expect(within(list).getByText(/· 2\.0km$/)).toBeTruthy();
      // 기기 좌표는 어디에도 없고 검색 지역(mapBounds)만 담는다
      expect(searchBodies[0]).toEqual({
        query: "근처 카페",
        mapBounds: BOUNDS,
      });
    });

    it("위치를 얻지 못해도 거르지 않고 거리 없이 보이며 지역 기준 안내와 위치 확인 중 안내가 없다(AC-52)", async () => {
      stubGeolocation("denied");
      renderScreen();

      const list = await newSearch("근처 카페");

      expect(rankedNames(list)).toEqual(["장소 1", "장소 3"]);
      expect(await screen.findByText("위치를 확인할 수 없어요")).toBeTruthy();
      expect(within(list).queryByText(/\d+m$/)).toBeNull();
      expect(
        screen.queryByText("위치를 확인할 수 없어 지역 기준으로 보여 드려요"),
      ).toBeNull();
      expect(screen.queryByText("위치를 확인하는 중")).toBeNull();
    });

    it("앱을 연 뒤 위치 조회가 끝나기 전에 받은 근처 응답도 위치 확인 중 안내 없이 바로 보인다(AC-52)", async () => {
      const location = stubLocationLater();
      renderScreen();
      // 위치 조회는 시작했고 아직 끝나지 않았다(initialView는 위치와 다른 상태라 보지 않는다)
      await waitFor(() =>
        expect(location.getCurrentPosition).toHaveBeenCalledTimes(1),
      );

      const list = await newSearch("근처 카페");

      expect(stores.current.getSnapshot().location).toEqual({
        status: "idle",
      });
      expect(rankedNames(list)).toEqual(["장소 1", "장소 3"]);
      expect(screen.queryByText("위치를 확인하는 중")).toBeNull();
      await location.succeed();
      expect(stores.current.getSnapshot().location.status).toBe("ok");
      expect(rankedNames(list)).toEqual(["장소 1", "장소 3"]);
    });

    // 점수 없는 근처 응답을 입력한 검색에 돌려준다. id 1이 가장 멀고 2가 가장 가깝다
    function stubUnscoredNearby() {
      const original = globalThis.fetch;
      const at = (id: number, lat: number) => ({
        ...card(id),
        score: undefined,
        place: { ...card(id).place, lat },
      });
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (input, init) =>
          init?.body && JSON.parse(String(init.body)).query === "근처 카페"
            ? Response.json({
                conditions: {},
                nearby: true,
                totalCount: 3,
                items: [at(1, 37.508), at(2, 37.5), at(3, 37.504)],
              } satisfies PlaceSearchResponse)
            : original(input, init),
        ),
      );
    }

    it("점수가 없는 근처 결과도 위치에서 가까운 순으로 다시 정렬하지 않고 서버 순서 그대로다(AC-52)", async () => {
      stubUnscoredNearby();
      stubGeolocation({ lat: 37.5, lng: 127.03 });
      renderScreen();

      const list = await newSearch("근처 카페");

      await waitFor(() =>
        expect(within(list).getAllByRole("listitem")).toHaveLength(3),
      );
      expect(rankedNames(list)).toEqual(["장소 1", "장소 2", "장소 3"]);
    });

    it("위치 권한이 정해지지 않았으면 근처 응답을 받아도 위치를 묻지 않고 안내 없이 서버 순서로 보인다(AC-52, AC-51)", async () => {
      stubUnscoredNearby();
      const getCurrentPosition = stubLocation({ permission: "prompt" });
      renderScreen();
      await waitFor(() =>
        expect(stores.current.getSnapshot().initialView).toBe("done"),
      );

      const list = await newSearch("근처 카페");

      await waitFor(() =>
        expect(within(list).getAllByRole("listitem")).toHaveLength(3),
      );
      expect(rankedNames(list)).toEqual(["장소 1", "장소 2", "장소 3"]);
      expect(screen.queryByText("위치를 확인하는 중")).toBeNull();
      expect(getCurrentPosition).not.toHaveBeenCalled();
      expect(stores.current.getSnapshot().location).toEqual({ status: "idle" });
    });
  });

  describe("검색 중", () => {
    async function startFollowUp(text: string) {
      fireEvent.change(screen.getByRole("textbox", { name: "후속 조건" }), {
        target: { value: text },
      });
      fireEvent.click(screen.getByRole("button", { name: "보내기" }));
      await screen.findByText("요청을 이해하는 중");
    }

    // 단계 문구와 "검색 취소"의 타이머. 이 타이머를 만들기 전에 가짜 타이머를 켜고, 켠 동안은 waitFor 대신 act로 진행한다
    const fakeStepTimers = () =>
      vi.useFakeTimers({
        toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
      });
    const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));

    it("첫 페이지를 받는 동안 단계 문구를 차례로 바꾸고, 3초가 지나면 '조금만 더 걸려요'로 바꾸며 후속 입력창을 막는다", async () => {
      renderScreen();
      await newSearch("역삼 카페");
      const held = holdSearches();
      fakeStepTimers();
      sendFollowUp("더 조용하게");
      await advance(0);

      expect(screen.getByText("요청을 이해하는 중")).toBeTruthy();
      const input = screen.getByRole("textbox", { name: "후속 조건" });
      expect(input.hasAttribute("disabled")).toBe(true);
      expect(screen.queryByRole("button", { name: "최근 검색" })).toBeNull();
      await advance(SEARCH_STEP_MS);
      expect(screen.getByText("주변 장소를 찾는 중")).toBeTruthy();
      await advance(SEARCH_SLOW_MS - SEARCH_STEP_MS - 1);
      expect(screen.queryByRole("button", { name: "검색 취소" })).toBeNull();
      await advance(1);
      expect(screen.getByText("조금만 더 걸려요")).toBeTruthy();
      expect(screen.getByRole("button", { name: "검색 취소" })).toBeTruthy();
      vi.useRealTimers();

      held[0]();
      await waitFor(() => expect(input.hasAttribute("disabled")).toBe(false));
    });

    it("'검색 취소'를 누르면 요청을 끊고 이전 결과로 돌아간다", async () => {
      renderScreen();
      await newSearch("역삼 카페");
      holdSearches();
      fakeStepTimers();
      sendFollowUp("더 조용하게");
      await advance(SEARCH_SLOW_MS);
      vi.useRealTimers();

      fireEvent.click(screen.getByRole("button", { name: "검색 취소" }));

      expect(
        await screen.findByRole("heading", { name: "“역삼 카페”" }),
      ).toBeTruthy();
      expect(screen.getByRole("list", { name: "추천 장소" })).toBeTruthy();
      expect(stores.current.getSnapshot().entries).toHaveLength(1);
    });

    it("첫 검색에서 '검색 취소'를 누르면 첫 화면으로 돌아간다", async () => {
      holdSearches();
      renderScreen();
      fakeStepTimers();
      fireEvent.change(screen.getByRole("textbox", { name: "장소 검색" }), {
        target: { value: "역삼 카페" },
      });
      fireEvent.submit(screen.getByRole("search"));
      await advance(SEARCH_SLOW_MS);
      vi.useRealTimers();

      fireEvent.click(screen.getByRole("button", { name: "검색 취소" }));

      expect(
        await screen.findByRole("textbox", { name: "장소 검색" }),
      ).toBeTruthy();
      expect(screen.queryByRole("region", { name: "추천 결과" })).toBeNull();
    });

    it("'새 검색'을 누르면 진행 중이던 요청의 결과가 늦게 와도 화면과 기록을 바꾸지 않는다", async () => {
      renderScreen();
      await newSearch("역삼 카페");
      const held = holdSearches();
      await startFollowUp("더 조용하게");
      await waitFor(() => expect(held).toHaveLength(1));

      fireEvent.click(screen.getByRole("button", { name: "새 검색" }));
      await releaseAndSettle(held[0]);

      expect(screen.getByRole("textbox", { name: "장소 검색" })).toBeTruthy();
      expect(screen.queryByRole("list", { name: "추천 장소" })).toBeNull();
      // "새 검색"이 thread를 닫아 기록이 비고, 늦게 온 결과는 쌓이지 않는다
      expect(stores.current.getSnapshot().entries).toHaveLength(0);
    });

    it("'결과 보기'를 누르면 진행 중이던 요청의 결과가 늦게 와도 고른 결과를 유지한다", async () => {
      renderScreen();
      await newSearch("역삼 카페");
      await followUp("더 조용하게");
      const held = holdSearches();
      await startFollowUp("카페 말고 식당");
      await waitFor(() => expect(held).toHaveLength(1));

      const history = await openHistory();
      fireEvent.click(
        within(history).getAllByRole("button", { name: "결과 보기" })[0],
      );
      await releaseAndSettle(held[0]);

      expect(stores.current.getSnapshot().entries).toHaveLength(2);
      expect(
        within(await pastView()).getByText(/결과 · “역삼 카페”$/),
      ).toBeTruthy();
    });
  });

  describe("다음 페이지", () => {
    // 목록 끝을 관찰하자마자 보이는 것으로 알린다
    function stubVisibleEnd() {
      vi.stubGlobal(
        "IntersectionObserver",
        class {
          constructor(
            private readonly callback: (
              entries: { isIntersecting: boolean }[],
            ) => void,
          ) {}
          observe() {
            this.callback([{ isIntersecting: true }]);
          }
          disconnect() {}
        },
      );
    }

    // 첫 페이지는 1, 2번과 커서, 다음 페이지는 3번. 후속 조건은 점수가 바뀐 3번
    function stubPages(nextPage: () => Response) {
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (input, init) => {
          if (String(input).startsWith("/api/v1/places/suggest")) {
            return Response.json([]);
          }
          const body = JSON.parse(String(init?.body));
          if (body.cursor) return nextPage();
          const followUp = body.previousConditions !== undefined;
          return Response.json({
            conditions: {},
            nearby: false,
            totalCount: 3,
            items: followUp ? [{ ...card(3), score: 99 }] : [card(1), card(2)],
            ...(!followUp && { nextCursor: "Mg" }),
          } satisfies PlaceSearchResponse);
        }),
      );
    }

    it("예전 요청을 다시 봐도 더 최근에 받은 카드를 덮어쓰지 않는다", async () => {
      stubVisibleEnd();
      stubPages(() =>
        Response.json({
          conditions: {},
          nearby: false,
          totalCount: 3,
          items: [card(3)],
        } satisfies PlaceSearchResponse),
      );
      renderScreen();
      const list = await newSearch("역삼 카페");
      await waitFor(() =>
        expect(within(list).getAllByRole("listitem")).toHaveLength(3),
      );
      expect(stores.current.getSnapshot().latestCards.get(3)?.score).toBe(83);
      await followUp("더 조용하게");
      expect(stores.current.getSnapshot().latestCards.get(3)?.score).toBe(99);

      const history = await openHistory();
      fireEvent.click(
        within(history).getByRole("button", { name: "결과 보기" }),
      );
      const past = await pastView();
      // 과거 결과는 그때 받아 둔 두 페이지를 보이고 더 부르지 않는다
      expect(
        within(
          within(past).getByRole("list", { name: "추천 장소" }),
        ).getAllByRole("listitem"),
      ).toHaveLength(3);

      expect(stores.current.getSnapshot().latestCards.get(3)?.score).toBe(99);
    });

    it("다음 페이지를 받지 못하면 오류 문구를 보여 주고 다시 불러올 수 있다", async () => {
      stubVisibleEnd();
      let fail = true;
      stubPages(() =>
        fail
          ? Response.json(
              { status: 400, detail: "bad cursor" },
              { status: 400 },
            )
          : Response.json({
              conditions: {},
              nearby: false,
              totalCount: 3,
              items: [card(3)],
            } satisfies PlaceSearchResponse),
      );
      renderScreen();
      const list = await newSearch("역삼 카페");

      expect(
        await screen.findByText("다음 장소를 불러오지 못했어요"),
      ).toBeTruthy();
      fail = false;
      fireEvent.click(screen.getByRole("button", { name: "다시 불러오기" }));

      await waitFor(() =>
        expect(within(list).getAllByRole("listitem")).toHaveLength(3),
      );
      expect(screen.queryByText("다음 장소를 불러오지 못했어요")).toBeNull();
    });
  });

  describe("첫 화면", () => {
    // 홈 주변 카드는 지도 영역으로 받으므로 지도가 있어야 한다(지도가 없으면 실패 안내, spec 75번)
    beforeEach(() => {
      config.value = { env: "dev", naverMapClientId: "key" };
      stubNaverMaps();
    });

    it("결과가 없으면 아래 검색창이, 결과가 있으면 결과 목록 아래 후속 입력창이 있다", async () => {
      renderScreen();
      const bar = screen.getByRole("textbox", { name: "장소 검색" });
      expect(bar.getAttribute("placeholder")).toBe(
        "분위기나 목적을 말해 보세요",
      );
      expect(screen.queryByRole("textbox", { name: "후속 조건" })).toBeNull();

      const list = await newSearch("역삼 카페");

      expect(screen.queryByRole("textbox", { name: "장소 검색" })).toBeNull();
      const input = screen.getByRole("textbox", { name: "후속 조건" });
      expect(
        list.compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it("위치가 없으면 서버가 준 주변 카드를 거르지 않고 거리 없이 보이고, 그 요청은 지도 영역만 보내며 기록에 쌓지 않는다 (AC-33, AC-28, AC-65)", async () => {
      renderScreen();

      const list = await nearbyList();

      expect(within(list).getByText("장소 1")).toBeTruthy();
      expect(within(list).getByText("장소 3")).toBeTruthy();
      expect(within(list).queryByText(/역삼역/)).toBeNull();
      expect(within(list).queryByText(/\d+m$|km$/)).toBeNull();
      // jsdom은 요소 크기가 0이라 보이는 영역 대신 getBounds() 전체를 쓰고, 이미 0.001도 격자 위라 그대로다
      expect(nearbyBodies).toEqual([{ mapBounds: BOUNDS }]);
      expect(searchBodies).toEqual([]);
      expect(stores.current.getSnapshot().entries).toEqual([]);
      // 상세 화면이 핏 점수와 추천 이유를 쓸 수 있게 둔다
      expect(stores.current.getSnapshot().latestCards.has(1)).toBe(true);

      fireEvent.click(within(list).getByRole("button", { pressed: true }));
      expect(push).toHaveBeenCalledWith("/places/1");
    });

    it("결과를 보는 동안에는 주변 카드가 없고 '새 검색'을 누르면 다시 보인다", async () => {
      renderScreen();
      await nearbyList();

      await newSearch("역삼 카페");
      expect(
        screen.queryByRole("region", { name: "주변 추천 장소" }),
      ).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "새 검색" }));
      expect(await nearbyList()).toBeTruthy();
      // 홈 진입으로 영역을 다시 확정했지만 같은 영역 key의 fresh cache라 다시 받지 않는다(AC-67)
      expect(nearbyBodies).toHaveLength(1);
    });

    it("위치 권한이 아직 정해지지 않았으면 열 때 위치를 묻지 않는다", async () => {
      const getCurrentPosition = stubLocation({ permission: "prompt" });
      renderScreen();

      await nearbyList();

      expect(getCurrentPosition).not.toHaveBeenCalled();
      expect(stores.current.getSnapshot().location).toEqual({ status: "idle" });
    });

    it("위치 권한이 꺼져 있으면 열 때 한 번만 알리고 위치를 묻지 않는다", async () => {
      const getCurrentPosition = stubLocation({ permission: "denied" });
      renderScreen();

      expect(
        await screen.findByText(
          /위치 권한이 꺼져 있어요\. 브라우저 설정에서 허용해 주세요\./,
        ),
      ).toBeTruthy();
      expect(getCurrentPosition).not.toHaveBeenCalled();

      // 상세에 갔다가 돌아온 것처럼 다시 그린다
      cleanup();
      renderScreen();
      await nearbyList();
      expect(
        screen.queryByText(
          /위치 권한이 꺼져 있어요\. 브라우저 설정에서 허용해 주세요\./,
        ),
      ).toBeNull();
    });

    it("자동완성은 입력한 단어마다 이름과 일치한 메뉴 이름에서 강조한다", async () => {
      const original = globalThis.fetch;
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (input, init) =>
          String(input).startsWith("/api/v1/places/suggest")
            ? Response.json([
                {
                  type: "PLACE",
                  place: { ...card(1).place, name: "하노이 쌀국수 역삼점" },
                  matchedMenu: "양지 쌀국수",
                },
                { type: "ACTION", label: "이 조건으로 추천받기" },
              ])
            : original(input, init),
        ),
      );
      renderScreen();
      const bar = screen.getByRole("textbox", { name: "장소 검색" });

      fireEvent.focus(bar);
      fireEvent.change(bar, { target: { value: "역삼 쌀국수" } });
      const list = await screen.findByRole("list", { name: "검색 추천" });

      // 이름에서는 두 단어가 각각, 메뉴 이름에서는 쌀국수가 강조된다
      expect(
        Array.from(list.querySelectorAll("mark")).map(
          (mark) => mark.textContent,
        ),
      ).toEqual(["쌀국수", "역삼", "쌀국수"]);
    });

    it("자동완성은 '이 조건으로 추천받기'를 맨 위에 두고, 후보가 보이는 동안 막을 깔며 막을 누르면 닫히고, 입력을 지울 수 있다", async () => {
      const original = globalThis.fetch;
      const suggestion = (id: number) => ({
        type: "PLACE",
        place: card(id).place,
      });
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (input, init) =>
          String(input).startsWith("/api/v1/places/suggest")
            ? Response.json([
                suggestion(1),
                suggestion(2),
                { type: "ACTION", label: "이 조건으로 추천받기" },
              ])
            : original(input, init),
        ),
      );
      renderScreen();
      const bar = screen.getByRole("textbox", { name: "장소 검색" });

      fireEvent.focus(bar);
      fireEvent.change(bar, { target: { value: "장소" } });
      const list = await screen.findByRole("list", { name: "검색 추천" });

      expect(
        within(list)
          .getAllByRole("button")
          .map((row) => row.textContent),
      ).toEqual([
        "이 조건으로 추천받기",
        expect.stringContaining("장소 1"),
        expect.stringContaining("장소 2"),
      ]);
      expect(screen.getByTestId("search-scrim")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "최근 검색" })).toBeNull();

      fireEvent.pointerDown(screen.getByTestId("search-scrim"));
      fireEvent.blur(bar);
      expect(screen.queryByRole("list", { name: "검색 추천" })).toBeNull();
      expect(screen.queryByTestId("search-scrim")).toBeNull();
      expect(bar).toHaveProperty("value", "장소");

      fireEvent.click(screen.getByRole("button", { name: "입력 지우기" }));
      expect(bar).toHaveProperty("value", "");
      expect(screen.getByRole("button", { name: "최근 검색" })).toBeTruthy();
    });

    it("내 정보 버튼은 /my로 이동한다", () => {
      renderScreen();
      fireEvent.click(screen.getByRole("button", { name: "내 정보" }));
      expect(push).toHaveBeenCalledWith("/my");
    });
    // 저장한 장소 버튼의 동작은 북마크 기능이 대체했다(saved-places.test.tsx)
    it("'저장한 장소' 버튼은 첫 화면과 결과 화면에 있고 '준비 중이에요'를 띄우지 않는다", async () => {
      renderScreen();
      fireEvent.click(screen.getByRole("button", { name: "저장한 장소" }));
      expect(await screen.findByText("로그인이 필요해요")).toBeTruthy();
      expect(screen.queryByText("준비 중이에요")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: "취소" }));

      await newSearch("역삼 카페");
      expect(screen.getByRole("button", { name: "저장한 장소" })).toBeTruthy();
    });

    describe("최근 검색", () => {
      async function openRecent() {
        fireEvent.click(screen.getByRole("button", { name: "최근 검색" }));
        return screen.findByRole("dialog", { name: "최근 검색" });
      }

      // 줄마다 지우기 버튼이 따로 있어 줄을 여는 버튼만 고른다
      const recentRows = (sheet: HTMLElement) =>
        within(within(sheet).getByRole("list", { name: "최근 검색 목록" }))
          .getAllByRole("button")
          .filter((button) => !button.hasAttribute("aria-label"));

      it("기록이 없으면 빈 안내를 보인다", async () => {
        renderScreen();

        const sheet = await openRecent();

        expect(
          within(sheet).getByText(
            "아직 검색한 요청이 없어요. 원하는 분위기나 목적을 말해 보세요.",
          ),
        ).toBeTruthy();
      });

      it("새 검색과 후속 조건은 한 thread로 남아, 재로드 뒤 고르면 네트워크 없이 마지막 결과와 요청 기록이 보이고 이어서 검색한다", async () => {
        renderScreen();
        await newSearch("역삼 카페");
        await followUp("더 조용하게");
        const requestCount = searchBodies.length;

        // 재로드처럼 화면 상태를 비우고 다시 연다
        cleanup();
        stores.current = createSearchStore();
        renderScreen();
        const sheet = await openRecent();

        const rows = recentRows(sheet);
        expect(rows).toHaveLength(1);
        expect(within(rows[0]).getByText("역삼 카페")).toBeTruthy();
        expect(
          within(rows[0]).getByText(/^오늘 오[전후] \d+:\d\d$/),
        ).toBeTruthy();
        fireEvent.click(rows[0]);

        await waitFor(() =>
          expect(
            screen.getByRole("heading", { name: "“역삼 카페”" }),
          ).toBeTruthy(),
        );
        expect(screen.getByText("추가 조건 · 더 조용하게")).toBeTruthy();
        expect(searchBodies).toHaveLength(requestCount);
        const history = await openHistory();
        expect(within(history).getAllByRole("listitem")).toHaveLength(2);
        fireEvent.click(screen.getByRole("button", { name: "요청 기록" }));

        await followUp("카페 말고 식당");
        expect(searchBodies.at(-1)).toEqual({
          query: "카페 말고 식당",
          previousConditions: { area: "역삼", quiet: true },
        });
        const reopened = await openRecent();
        expect(recentRows(reopened)).toHaveLength(1);
        expect(within(reopened).getByText("보는 중")).toBeTruthy();
      });

      it("'새 검색' 뒤의 검색은 새 thread가 되어 목록 맨 위에 '보는 중'으로 보이고, 요청 기록에는 그 thread만 보인다", async () => {
        renderScreen();
        await newSearch("역삼 카페");
        await followUp("더 조용하게");
        fireEvent.click(screen.getByRole("button", { name: "새 검색" }));
        await newSearch("강남 술집");

        const history = await openHistory();
        expect(within(history).getAllByRole("listitem")).toHaveLength(1);
        expect(within(history).getByText("강남 술집")).toBeTruthy();
        fireEvent.click(screen.getByRole("button", { name: "요청 기록" }));

        const sheet = await openRecent();
        const rows = recentRows(sheet);
        expect(rows.map((row) => row.textContent)).toEqual([
          expect.stringMatching(/^강남 술집보는 중/),
          expect.stringMatching(/^역삼 카페오늘/),
        ]);
      });

      it("다른 thread를 고르면 그 thread로 바뀐다", async () => {
        renderScreen();
        await newSearch("역삼 카페");
        fireEvent.click(screen.getByRole("button", { name: "새 검색" }));
        await newSearch("강남 술집");

        const sheet = await openRecent();
        fireEvent.click(
          recentRows(sheet).find((row) =>
            row.textContent?.startsWith("역삼 카페"),
          )!,
        );

        await waitFor(() =>
          expect(
            screen.getByRole("heading", { name: "“역삼 카페”" }),
          ).toBeTruthy(),
        );
        expect(stores.current.getSnapshot().entries).toHaveLength(1);
      });

      it("저장된 값이 깨져 있어도 목록이 비고 검색은 동작한다", async () => {
        localStorage.setItem("fit-dining:guest-search-threads", "{");
        renderScreen();

        const sheet = await openRecent();
        expect(
          within(sheet).getByText(
            "아직 검색한 요청이 없어요. 원하는 분위기나 목적을 말해 보세요.",
          ),
        ).toBeTruthy();
        fireEvent.keyDown(sheet, { key: "Escape" });
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        await newSearch("역삼 카페");
      });

      it("기기 저장소를 쓸 수 없어도 검색은 동작하고 목록은 비어 있다", async () => {
        vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
          throw new DOMException("QuotaExceededError");
        });
        renderScreen();

        await newSearch("역삼 카페");
        const sheet = await openRecent();

        expect(
          within(sheet).getByText(
            "아직 검색한 요청이 없어요. 원하는 분위기나 목적을 말해 보세요.",
          ),
        ).toBeTruthy();
        vi.restoreAllMocks();
      });
    });
  });

  // 요청이 실패하는 화면(4-E03, 5-E01, 5-E03, 5-E04). 400은 재시도하지 않아 곧바로 실패한다
  describe("불러오기 실패", () => {
    // 홈 주변 카드는 지도 영역으로 받으므로 지도가 있어야 한다(지도가 없으면 실패 안내, spec 75번)
    beforeEach(() => {
      config.value = { env: "dev", naverMapClientId: "key" };
      stubNaverMaps();
    });

    // match에 맞는 요청을 times번 실패시키고 그 뒤로는 원래대로 응답한다
    function failRequests(
      match: (url: string, body?: { query?: string }) => boolean,
      { times = 1, offline = false } = {},
    ) {
      const original = globalThis.fetch;
      let left = times;
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (input, init) => {
          const url = String(input);
          const body = init?.body ? JSON.parse(String(init.body)) : undefined;
          if (left > 0 && match(url, body)) {
            left -= 1;
            if (offline) throw new TypeError("Failed to fetch");
            return Response.json(
              { status: 400, title: "Bad Request" },
              { status: 400 },
            );
          }
          return original(input, init);
        }),
      );
    }
    // 검색(/places/search, /places/search/region)과 홈 주변 카드(/places/nearby)는 주소로 가린다
    const isSearch = (url: string) => url.startsWith("/api/v1/places/search");
    const isNearby = (url: string) => url === "/api/v1/places/nearby";

    it("추천을 받지 못하면 결과 패널에 안내와 '다시 시도'를 보이고, 다시 시도하면 결과를 보인다", async () => {
      failRequests(isSearch);
      renderScreen();
      fireEvent.change(screen.getByRole("textbox", { name: "장소 검색" }), {
        target: { value: "역삼 카페" },
      });
      fireEvent.submit(screen.getByRole("search"));

      const panel = await screen.findByRole("region", { name: "추천 결과" });
      expect(
        await within(panel).findByText("추천을 불러오지 못했어요"),
      ).toBeTruthy();
      expect(
        within(panel).getByText("잠시 후 다시 시도해 주세요."),
      ).toBeTruthy();
      expect(
        within(panel).getByRole("heading", { name: "“역삼 카페”" }),
      ).toBeTruthy();

      fireEvent.click(within(panel).getByRole("button", { name: "다시 시도" }));

      expect(
        await screen.findByRole("list", { name: "추천 장소" }),
      ).toBeTruthy();
      expect(screen.queryByText("추천을 불러오지 못했어요")).toBeNull();
      expect(searchBodies).toHaveLength(1);
    });

    // 연결 실패는 두 번 더 보낸 뒤 실패한다(테스트 client는 재시도 사이 대기가 없다)
    it("연결이 없어 추천을 받지 못하면 연결 안내를 보인다", async () => {
      renderScreen();
      await newSearch("역삼 카페");
      failRequests(isSearch, { times: 3, offline: true });

      sendFollowUp("더 조용하게");

      expect(
        await screen.findByText("인터넷에 연결되어 있지 않아요"),
      ).toBeTruthy();
      expect(
        screen.getByText("연결을 확인하고 다시 시도해 주세요."),
      ).toBeTruthy();
      expect(screen.queryByRole("list", { name: "추천 장소" })).toBeNull();
    });

    it("보인 카드가 없을 때 주변 추천을 받지 못하면 카드 자리에 안내를 보이고, 다시 시도는 같은 영역으로 받는다 (AC-72)", async () => {
      failRequests(isNearby);
      renderScreen();

      expect(
        await screen.findByText("주변 추천을 불러오지 못했어요"),
      ).toBeTruthy();
      expect(skeleton()).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

      expect(await nearbyList()).toBeTruthy();
      expect(screen.queryByText("주변 추천을 불러오지 못했어요")).toBeNull();
      expect(nearbyBodies).toEqual([{ mapBounds: BOUNDS }]);
    });

    it("카드가 보이는 채 같은 영역을 다시 받다가 실패하면 카드가 그대로이고 실패 안내와 연결 안내가 없다 (AC-72)", async () => {
      // AI 대체 응답은 staleTime 0이라 홈 진입 때 같은 key로 다시 받는다
      aiFallback.nearby = true;
      renderScreen();
      await nearbyList();
      await newSearch("역삼 카페");
      failRequests(isNearby, { times: 3, offline: true });
      const nearbyCalls = () =>
        vi
          .mocked(globalThis.fetch)
          .mock.calls.filter(([url]) => isNearby(String(url))).length;

      fireEvent.click(screen.getByRole("button", { name: "새 검색" }));

      await waitFor(() => expect(nearbyCalls()).toBe(3));
      await waitFor(() => expect(clients[0].isFetching()).toBe(0));
      await act(async () => {});
      expect(
        screen.getByRole("region", { name: "주변 추천 장소" }),
      ).toBeTruthy();
      expect(screen.queryByText("주변 추천을 불러오지 못했어요")).toBeNull();
      expect(screen.queryByText("인터넷에 연결되어 있지 않아요")).toBeNull();
    });

    it("연결이 없어 주변 추천을 받지 못하면 검색창이 꺼지고 최근 검색 버튼이 없다", async () => {
      failRequests(isNearby, { times: 3, offline: true });
      renderScreen();

      expect(
        await screen.findByText("인터넷에 연결되어 있지 않아요"),
      ).toBeTruthy();
      expect(
        screen
          .getByRole("textbox", { name: "장소 검색" })
          .hasAttribute("disabled"),
      ).toBe(true);
      expect(screen.queryByRole("button", { name: "최근 검색" })).toBeNull();

      fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

      expect(await nearbyList()).toBeTruthy();
      expect(
        screen
          .getByRole("textbox", { name: "장소 검색" })
          .hasAttribute("disabled"),
      ).toBe(false);
    });

    it("자동완성 후보를 받지 못하면 '이 조건으로 추천받기'와 안내만 보인다", async () => {
      failRequests((url) => url.startsWith("/api/v1/places/suggest"));
      renderScreen();

      fireEvent.focus(screen.getByRole("textbox", { name: "장소 검색" }));
      fireEvent.change(screen.getByRole("textbox", { name: "장소 검색" }), {
        target: { value: "역삼 쌀국수" },
      });

      const list = await screen.findByRole("list", { name: "검색 추천" });
      expect(
        await within(list).findByText("지금은 후보를 보여 드릴 수 없어요"),
      ).toBeTruthy();
      expect(
        within(list).getByRole("button", { name: "이 조건으로 추천받기" }),
      ).toBeTruthy();
    });
  });
  describe("AI 대신 키워드로 찾은 결과", () => {
    // 홈 주변 카드는 지도 영역으로 받으므로 지도가 있어야 한다(지도가 없으면 실패 안내, spec 75번)
    beforeEach(() => {
      config.value = { env: "dev", naverMapClientId: "key" };
      stubNaverMaps();
    });

    const NOTICE = "지금은 AI 추천을 쓸 수 없어 가게 이름·메뉴로 찾았어요";
    const HOME_NOTICE =
      "지도 안의 장소만 보여드려요. 검색 조건은 적용되지 않았어요";

    it("검색 결과가 대체 결과이고 카드가 있으면 목록 위에 안내가 보인다", async () => {
      aiFallback.search = true;
      renderScreen();

      await newSearch("역삼 카페");

      expect(screen.getByText(NOTICE)).toBeTruthy();
    });

    it("대체 결과가 아니면 첫 화면 주변 카드에 안내가 없다", async () => {
      renderScreen();
      await nearbyList();

      expect(screen.queryByText(HOME_NOTICE)).toBeNull();
      expect(screen.queryByText(NOTICE)).toBeNull();
    });

    it("대체 결과가 아니면 검색 결과에 안내가 없다", async () => {
      renderScreen();

      await newSearch("역삼 카페");

      expect(screen.queryByText(NOTICE)).toBeNull();
      expect(screen.queryByText(HOME_NOTICE)).toBeNull();
    });

    it("대체 결과에 카드가 없으면 안내 없이 emptyReason만 보인다", async () => {
      aiFallback.search = true;
      renderScreen();
      fireEvent.change(screen.getByRole("textbox", { name: "장소 검색" }), {
        target: { value: "없는 가게" },
      });
      fireEvent.submit(screen.getByRole("search"));

      expect(await screen.findByText("찾지 못했어요")).toBeTruthy();
      expect(screen.queryByText(NOTICE)).toBeNull();
    });

    it("첫 화면 주변 카드가 대체 결과면 카드 위에 지도 안 장소 안내가 보이고, 홈 진입 때 같은 영역으로 새로 받는다 (AC-60, AC-72, AC-66)", async () => {
      aiFallback.nearby = true;
      renderScreen();
      const list = await nearbyList();
      const note = screen.getByText(HOME_NOTICE);
      expect(
        note.compareDocumentPosition(list) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(screen.queryByText(NOTICE)).toBeNull();

      await newSearch("역삼 카페");
      fireEvent.click(screen.getByRole("button", { name: "새 검색" }));
      await nearbyList();

      // fallback은 staleTime 0이라 cache의 카드를 먼저 그리고 뒤에서 같은 영역으로 다시 받는다
      await waitFor(() => expect(nearbyBodies).toHaveLength(2));
      expect(nearbyBodies[1]).toEqual(nearbyBodies[0]);
    });

    it("첫 화면 대체 결과도 창 포커스나 재연결로는 다시 받지 않는다 (AC-66)", async () => {
      aiFallback.nearby = true;
      renderScreen();
      await nearbyList();
      await waitFor(() => expect(clients[0].isFetching()).toBe(0));

      act(() => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
        onlineManager.setOnline(false);
        onlineManager.setOnline(true);
      });

      // 다시 받기를 시작했다면 그 자리에서 fetching이 된다
      expect(clients[0].isFetching()).toBe(0);
      expect(nearbyBodies).toHaveLength(1);
    });
  });
});
