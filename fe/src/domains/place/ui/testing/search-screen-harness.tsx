// search-screen*.test.tsx가 함께 쓰는 helper와 준비·정리. vi.mock은 hoisting 때문에 각 test 파일에 남긴다
import {
  focusManager,
  notifyManager,
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
} from "@testing-library/react";
import { Activity } from "react";
import { afterEach, beforeEach, expect, type Mock, vi } from "vitest";

import { createQueryClient } from "@/shared/api/query-client";
import type { RuntimeConfig } from "@/shared/lib/runtime-config";
import { ToastProvider } from "@/shared/ui/overlay/toast";

import type { BookmarkAccess } from "../../model/bookmark";
import type { PlaceCard, PlaceSearchResponse } from "../../model/place-types";
import { createSearchStore, type SearchStore } from "../../model/search-store";
import { SearchScreen } from "../search-screen";
import { resetThreadSession } from "../thread-storage";

// 인증은 북마크 테스트(place-detail-bookmark, saved-places)가 본다. 여기서는 비로그인이다
export const guest: BookmarkAccess = {
  session: { status: "guest" },
  currentUserId: () => undefined,
  send: () => Promise.reject(new Error("비로그인")),
  endSession: () => {},
  login: () => {},
};

export function card(id: number): PlaceCard {
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
export let searchBodies: Record<string, unknown>[];
export let searchUrls: string[];
export let nearbyBodies: Record<string, unknown>[];
// 켜면 그 응답에 X-Fallback: AI_UNAVAILABLE을 붙인다(BE가 AI 대신 키워드로 찾은 결과)
export let aiFallback: { nearby: boolean; search: boolean };

export const fallbackHeaders = (on: boolean) =>
  on ? { headers: { "X-Fallback": "AI_UNAVAILABLE" } } : undefined;

// 첫 요청은 conditions {area: "역삼"}, 후속 조건이면 changeSummary가 있다. "없는"이 들어가면 빈 결과다
export function stubApi() {
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
export const clients: QueryClient[] = [];
// 재시도 횟수는 제품 그대로 두고 재시도 사이 대기만 없앤다(재시도 정책은 query-client 테스트가 본다)
export function newClient() {
  const client = createQueryClient();
  const defaults = client.getDefaultOptions();
  client.setDefaultOptions({
    ...defaults,
    queries: { ...defaults.queries, retryDelay: 0 },
  });
  clients.push(client);
  return client;
}

export function renderScreen() {
  return render(
    <QueryClientProvider client={newClient()}>
      <ToastProvider>
        <SearchScreen bookmarks={guest} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

// 지도 인증 실패는 페이지 세션(shared/lib/naver-maps 모듈)에 남는다. 그 테스트는 모듈을 새로 읽어 새 페이지 세션에서 그린다.
// React Query는 node_modules라 다시 읽히지 않아 같은 Provider를 쓴다
export async function renderInNewPageSession() {
  vi.resetModules();
  const [screenModule, toastModule] = await Promise.all([
    import("../search-screen"),
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
export function renderHideableScreen() {
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

export const mapState = () =>
  document.querySelector("[data-map-state]")?.getAttribute("data-map-state");

// 지도가 그려지고 검색 화면도 그 알림을 받은 뒤. data-map-state는 PlaceMap이 바로 그리지만, 지도 위 버튼("내 위치",
// "이 지역에서 검색")은 검색 화면이 onReadyChange를 받은 다음 렌더에 그린다. 그 사이 한 commit에는 버튼이 없다
export async function mapReady() {
  await waitFor(() => {
    expect(mapState()).toBe("ready");
    expect(screen.getByRole("button", { name: "내 위치" })).toBeTruthy();
  });
}

export async function newSearch(text: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "장소 검색" }), {
    target: { value: text },
  });
  fireEvent.submit(screen.getByRole("search"));
  return screen.findByRole("list", { name: "추천 장소" });
}

export function sendFollowUp(text: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "후속 조건" }), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: "보내기" }));
}

// 후속 입력은 제목이 아니라 칩으로 보인다(D-97)
export async function followUp(text: string) {
  sendFollowUp(text);
  expect(await screen.findByText(`추가 조건 · ${text}`)).toBeTruthy();
}

// 결과 패널 머리글의 "요청 기록"으로 패널 안에 펼친다
export async function openHistory() {
  fireEvent.click(screen.getByRole("button", { name: "요청 기록" }));
  return screen.findByRole("list", { name: "요청 기록" });
}

export const pastView = () =>
  screen.findByRole("region", { name: "과거 결과" });

// 검색 요청(/places/search, /places/search/region)만 붙잡는다. held[i]()가 그 요청을 놓고 원래 응답의 Promise를 돌려준다
export function holdSearches() {
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
export async function releaseAndSettle(release: () => Promise<Response>) {
  await act(async () => {
    await release();
  });
  await waitFor(() => {
    expect(clients.at(-1)!.isFetching()).toBe(0);
    expect(clients.at(-1)!.isMutating()).toBe(0);
  });
  await act(async () => {});
}

// use-suggest.ts의 DEBOUNCE_MS. 자동완성은 입력이 멈추고 이만큼 지난 뒤 요청한다(AC-15는 use-suggest.test.tsx가 본다)
export const SUGGEST_DEBOUNCE_MS = 300;

// 검색창에 입력하고 자동완성 debounce를 기다리지 않고 시계만 앞으로 돌린다.
// react-query는 화면 알림을 0ms setTimeout으로 예약한다. 가짜 시계에 남은 예약은 실제 시계로 돌아온 뒤 돌지 않으므로,
// 가짜 시계 동안만 알림을 microtask로 예약한다. gc·stale timer(5분 이상)는 가짜 시계에 남아도 test 안에서는 돌 일이 없다
export async function typeSuggest(bar: HTMLElement, value: string) {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  notifyManager.setScheduler(queueMicrotask);
  try {
    fireEvent.change(bar, { target: { value } });
    await act(() => vi.advanceTimersByTimeAsync(SUGGEST_DEBOUNCE_MS));
  } finally {
    vi.useRealTimers();
    notifyManager.setScheduler((callback) => setTimeout(callback, 0));
  }
}

// 화면을 열 때 보는 위치 권한과 기기 위치. permission이 없으면 Permissions API가 없는 브라우저다
export function stubLocation({
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
export function stubNearbyItems(items: PlaceCard[]) {
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

export const nearbyList = () =>
  screen.findByRole("region", { name: "주변 추천 장소" });

// 홈 영역을 확정해 카드를 받기 전의 카드 자리(spec 73번)
export const SKELETON = "주변 추천을 불러오는 중";
export const skeleton = () => screen.queryByRole("status", { name: SKELETON });

// 지도를 쓸 수 없어 홈 영역을 정할 수 없을 때 카드 자리의 안내(spec 75번)
export const MAP_FAILED_TITLE = "지도를 불러오지 못했어요";

// 처음 이동(panTo)이 끝난 화면의 영역. 이동 전 영역(BOUNDS)과 달라야 처음 홈 요청이 이동 뒤 화면으로 나갔는지 가린다.
// 0.001도 격자 위라 정규화해도 그대로다
export const AFTER_INITIAL_MOVE = {
  swLat: 37.495,
  swLng: 127.025,
  neLat: 37.505,
  neLng: 127.035,
};
export const MAP_FAILED_DESCRIPTION =
  "주변 추천을 보려면 지도가 필요해요. 아래 검색창으로 장소를 직접 찾아볼 수 있어요.";

export const HERE = { lat: 37.5, lng: 127.03 };

// 권한은 허용이고 위치 조회는 테스트가 끝낼 때까지 기다린다. 부른 순서대로 끝낸다
export function stubLocationLater() {
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

// 각 test 파일이 vi.hoisted로 만든 상태. vi.mock factory와 같은 객체여야 하고, vi.resetModules() 뒤에도 바뀌지 않는다
export type SearchScreenState = {
  stores: { current: SearchStore };
  config: { value: RuntimeConfig | undefined };
  push: Mock;
};

// 모든 test 앞뒤의 준비와 정리. 각 test 파일이 맨 위에서 한 번 부른다
export function setUpSearchScreen({ stores, config, push }: SearchScreenState) {
  beforeEach(() => {
    stores.current = createSearchStore();
    // 기기 기록의 thread 상태(thread-storage의 모듈 변수)를 앞 test에서 이어받지 않는다
    resetThreadSession();
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
}
