// @vitest-environment jsdom
import {
  focusManager,
  onlineManager,
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
import { NEARBY_QUERY } from "../model/search-request";
import { createSearchStore, type SearchStore } from "../model/search-store";
import { SearchScreen } from "./search-screen";

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

// 사용자가 보낸 검색 요청 본문. 첫 화면 주변 카드 요청은 nearbyBodies에 따로 모은다
let searchBodies: Record<string, unknown>[];
let nearbyBodies: Record<string, unknown>[];
// 켜면 그 응답에 X-Fallback: AI_UNAVAILABLE을 붙인다(BE가 AI 대신 키워드로 찾은 결과)
let aiFallback: { nearby: boolean; search: boolean };

const fallbackHeaders = (on: boolean) =>
  on ? { headers: { "X-Fallback": "AI_UNAVAILABLE" } } : undefined;

// 첫 요청은 conditions {area: "역삼"}, 후속 조건이면 changeSummary가 있다. "없는"이 들어가면 빈 결과다
function stubApi() {
  searchBodies = [];
  nearbyBodies = [];
  aiFallback = { nearby: false, search: false };
  vi.stubGlobal(
    "fetch",
    vi.fn<typeof fetch>(async (input, init) => {
      const url = String(input);
      if (url.startsWith("/api/v1/places/suggest")) return Response.json([]);
      const body = JSON.parse(String(init?.body));
      (body.query === NEARBY_QUERY ? nearbyBodies : searchBodies).push(body);
      const followUp = body.previousConditions !== undefined;
      if (body.query.includes("근처")) {
        // 1번은 역삼역 바로 앞, 3번은 약 2km 떨어진 곳
        const far = { ...card(3), place: { ...card(3).place, lat: 37.518 } };
        return Response.json(
          {
            conditions: {},
            nearby: true,
            totalCount: 2,
            items: [card(1), far],
          } satisfies PlaceSearchResponse,
          fallbackHeaders(
            body.query === NEARBY_QUERY ? aiFallback.nearby : aiFallback.search,
          ),
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

function renderScreen() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <ToastProvider>
        <SearchScreen bookmarks={guest} />
      </ToastProvider>
    </QueryClientProvider>,
  );
}

// 다른 화면으로 가면 Next가 이 화면을 숨겨 두었다가(Effect 정리) 돌아오면 다시 보인다. 그 숨김을 흉내 낸다
function renderHideableScreen() {
  const client = createQueryClient();
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

beforeEach(() => {
  stores.current = createSearchStore();
  stubApi();
  config.value = undefined;
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
  // 첫 화면 주변 카드의 Carousel(Embla)이 부른다. jsdom에는 없다
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  push.mockReset();
});

const BOUNDS = { swLat: 37.49, swLng: 127.02, neLat: 37.51, neLng: 127.05 };

// 네이버 지도 SDK 흉내. Marker만 바꿔 끼울 수 있다. fire로 지도 이벤트(사용자가 끌기 등)를 일으킨다
function stubNaverMaps({ Marker }: { Marker?: unknown } = {}) {
  const listeners: { target: unknown; name: string; listener: () => void }[] =
    [];
  const latLng = (lat: number, lng: number) => ({
    lat: () => lat,
    lng: () => lng,
  });
  const created: {
    // 지도를 만들 때 넘긴 처음 중심과 확대 정도
    options: { center: { lat(): number; lng(): number }; zoom: number };
    setSize: ReturnType<typeof vi.fn>;
    panTo: ReturnType<typeof vi.fn>;
    morph: ReturnType<typeof vi.fn>;
    getCenter: ReturnType<typeof vi.fn>;
    getZoom: ReturnType<typeof vi.fn>;
  }[] = [];
  const maps = {
    Map: class {
      constructor(
        _: unknown,
        readonly options: {
          center: { lat(): number; lng(): number };
          zoom: number;
        },
      ) {
        created.push(this);
      }
      getBounds = () => ({
        getSW: () => latLng(BOUNDS.swLat, BOUNDS.swLng),
        getNE: () => latLng(BOUNDS.neLat, BOUNDS.neLng),
      });
      // 처음 중심은 기기 위치와 멀다. 테스트가 바꿔 "이미 그 위치"를 흉내 낸다
      getCenter = vi.fn(() => latLng(0, 0));
      // 처음 확대 정도. 테스트가 바꿔 사용자가 확대·축소해 둔 지도를 흉내 낸다
      getZoom = vi.fn(() => 15);
      panTo = vi.fn();
      morph = vi.fn();
      setSize = vi.fn();
      destroy() {}
    },
    LatLng: class {
      constructor(
        readonly latValue: number,
        readonly lngValue: number,
      ) {}
      lat = () => this.latValue;
      lng = () => this.lngValue;
    },
    Size: class {
      constructor(
        readonly width: number,
        readonly height: number,
      ) {}
    },
    Point: class {},
    Marker:
      Marker ??
      class {
        setMap() {}
        setIcon() {}
        setZIndex() {}
      },
    Event: {
      addListener(target: unknown, name: string, listener: () => void) {
        const entry = { target, name, listener };
        listeners.push(entry);
        return entry;
      },
      removeListener(entry: unknown) {
        listeners.splice(listeners.indexOf(entry as never), 1);
      },
    },
  };
  vi.stubGlobal("naver", { maps });
  // 지도에 건 이벤트만 일으킨다
  const fire = (name: string) =>
    act(() =>
      listeners
        .filter(
          (entry) =>
            entry.name === name && created.includes(entry.target as never),
        )
        .forEach(({ listener }) => listener()),
    );
  return { created, fire };
}

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
      if (init?.body && JSON.parse(String(init.body)).query === NEARBY_QUERY) {
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
  // 인증 실패 알림은 모듈에 남으므로 지도가 있어야 하는 테스트는 그 테스트보다 먼저 둔다
  describe("지도가 있을 때", () => {
    let map: ReturnType<typeof stubNaverMaps>;
    const regionButton = () =>
      screen.queryByRole("button", { name: "이 지역에서 검색" });

    beforeEach(() => {
      config.value = { env: "dev", naverMapClientId: "key" };
      map = stubNaverMaps();
    });

    it("평소 첫 페이지 요청에는 지도 영역을 담지 않는다", async () => {
      renderScreen();
      await waitFor(() => expect(mapState()).toBe("ready"));

      await newSearch("역삼 카페");
      await followUp("더 조용하게");

      expect(searchBodies.map((body) => body.mapBounds)).toEqual([
        undefined,
        undefined,
      ]);
    });

    it("위치를 얻지 못한 뒤에는(앱을 열 때 권한 거부 포함) '새 검색' 뒤에도 첫 페이지 요청에 현재 지도 영역을 담는다", async () => {
      stubLocation({ permission: "denied" });
      renderScreen();
      await waitFor(() => expect(mapState()).toBe("ready"));
      await waitFor(() =>
        expect(stores.current.getSnapshot().location.status).toBe("failed"),
      );
      await newSearch("근처 카페");
      await screen.findByText(
        "위치를 확인할 수 없어 지역 기준으로 보여 드려요",
      );

      fireEvent.click(screen.getByRole("button", { name: "새 검색" }));
      await newSearch("역삼 카페");
      await followUp("더 조용하게");

      expect(searchBodies.map((body) => body.mapBounds)).toEqual([
        BOUNDS,
        BOUNDS,
        BOUNDS,
      ]);
    });

    it("'이 지역에서 검색'은 지금 보는 요청을 지도 영역과 다시 보내고, '새 검색' 전까지 후속 조건에도 담는다", async () => {
      renderScreen();
      await waitFor(() => expect(mapState()).toBe("ready"));
      await newSearch("역삼 카페");

      map.fire("dragend");
      fireEvent.click(
        await screen.findByRole("button", { name: "이 지역에서 검색" }),
      );
      await waitFor(() =>
        expect(stores.current.getSnapshot().entries).toHaveLength(2),
      );
      expect(stores.current.getSnapshot().entries[1].sentence).toBe(
        "역삼 카페",
      );
      await followUp("더 조용하게");
      fireEvent.click(screen.getByRole("button", { name: "새 검색" }));
      await newSearch("강남 술집");

      expect(searchBodies.slice(1)).toEqual([
        { query: "역삼 카페", mapBounds: BOUNDS },
        {
          query: "더 조용하게",
          previousConditions: { area: "역삼" },
          mapBounds: BOUNDS,
        },
        { query: "강남 술집" },
      ]);
    });

    describe("'이 지역에서 검색' 버튼", () => {
      it.each(["dragend", "zoom_changed"])(
        "결과가 있어도 지도를 움직이기 전에는 없고, %s 뒤에 나타난다",
        async (event) => {
          renderScreen();
          await waitFor(() => expect(mapState()).toBe("ready"));
          await newSearch("역삼 카페");
          expect(regionButton()).toBeNull();

          map.fire(event);

          expect(regionButton()).toBeTruthy();
        },
      );

      it("카드를 눌러 지도가 옮겨 가도 나타나지 않는다", async () => {
        renderScreen();
        await waitFor(() => expect(mapState()).toBe("ready"));
        const list = await newSearch("역삼 카페");

        fireEvent.click(within(list).getAllByRole("button")[1]);

        expect(map.created[0].panTo).toHaveBeenCalled();
        expect(regionButton()).toBeNull();
      });

      it("누르거나, 보는 결과가 바뀌거나, '새 검색'을 누르면 숨는다", async () => {
        renderScreen();
        await waitFor(() => expect(mapState()).toBe("ready"));
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
        await waitFor(() => expect(mapState()).toBe("ready"));
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
        await waitFor(() => expect(mapState()).toBe("ready"));

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
          await waitFor(() => expect(mapState()).toBe("ready"));
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
        await waitFor(() => expect(mapState()).toBe("ready"));
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
        await waitFor(() => expect(mapState()).toBe("ready"));
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
        await waitFor(() => expect(mapState()).toBe("ready"));
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

      it("처음 이동 중에 화면을 숨겼다 다시 보여도 다시 옮기지 않는다", async () => {
        const device = stubLocationLater();
        const view = renderHideableScreen();
        await waitFor(() => expect(mapState()).toBe("ready"));
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
        await waitFor(() => expect(mapState()).toBe("ready"));
        await waitFor(() =>
          expect(device.getCurrentPosition).toHaveBeenCalled(),
        );

        const locationButton = screen.getByRole("button", { name: "내 위치" });
        // 앱을 열 때의 위치 요청에는 색이 바뀌지 않고, 그 조회 중에 누르면 그 순간부터 파란색이다
        expect(locationButton.getAttribute("aria-busy")).toBe("false");
        fireEvent.click(locationButton);
        expect(locationButton.getAttribute("aria-busy")).toBe("true");
        expect(initialView()).toBe("done");
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
      });

      it("위치를 기다리는 동안 지도를 끌면 처음 이동이 취소되고, 늦게 온 위치는 내 위치 점으로만 남는다", async () => {
        const device = stubLocationLater();
        renderScreen();
        await waitFor(() => expect(mapState()).toBe("ready"));
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

      it("위치가 늦게 오면 그때 그 위치 기준으로 주변 카드를 다시 거른다", async () => {
        const device = stubLocationLater();
        renderScreen();
        const list = await nearbyList();
        await waitFor(() =>
          expect(within(list).getByText(/· 역삼역 \d+m$/)).toBeTruthy(),
        );

        await device.succeed();

        await waitFor(() =>
          expect(within(list).getByText(/· 0m$/)).toBeTruthy(),
        );
        expect(within(list).queryByText(/역삼역/)).toBeNull();
      });

      it("처음 이동으로는 결과 화면의 '이 지역에서 검색' 버튼이 나타나지 않는다", async () => {
        const device = stubLocationLater();
        renderScreen();
        await waitFor(() => expect(mapState()).toBe("ready"));
        await waitFor(() =>
          expect(device.getCurrentPosition).toHaveBeenCalled(),
        );
        await newSearch("역삼 카페");

        await device.succeed();
        await waitFor(() => expect(map.created[0].panTo).toHaveBeenCalled());
        map.fire("idle");

        expect(regionButton()).toBeNull();
      });

      it("근처 응답에서 '위치를 확인하는 중'은 처음 이동이 끝나기 전에만 보이고, 끝나면 위치로 거른 결과가 보인다", async () => {
        const device = stubLocationLater();
        renderScreen();
        await waitFor(() => expect(mapState()).toBe("ready"));
        await waitFor(() =>
          expect(device.getCurrentPosition).toHaveBeenCalled(),
        );
        fireEvent.change(screen.getByRole("textbox", { name: "장소 검색" }), {
          target: { value: "근처 카페" },
        });
        fireEvent.submit(screen.getByRole("search"));

        expect(await screen.findByText("위치를 확인하는 중")).toBeTruthy();

        await device.succeed();
        map.fire("idle");
        const list = await screen.findByRole("list", { name: "추천 장소" });
        await waitFor(() =>
          expect(within(list).getAllByRole("listitem")).toHaveLength(1),
        );
        expect(screen.queryByText("위치를 확인하는 중")).toBeNull();
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
        await waitFor(() => expect(mapState()).toBe("ready"));
        expect(await screen.findByText(/위치 권한이 꺼져 있어요/)).toBeTruthy();

        fireEvent.click(screen.getByRole("button", { name: "내 위치" }));

        expect(await screen.findByText("위치를 확인할 수 없어요")).toBeTruthy();
      });
    });

    describe("첫 화면", () => {
      it("위치 권한이 이미 허용이면 열 때 위치를 받아 지도를 그 위치로 옮기고, 그 위치 기준 주변 카드를 보인다", async () => {
        const getCurrentPosition = stubLocation({
          permission: "granted",
          position: { lat: 37.5, lng: 127.03 },
        });
        renderScreen();
        await waitFor(() => expect(mapState()).toBe("ready"));

        await waitFor(() => expect(map.created[0].panTo).toHaveBeenCalled());
        expect(map.created[0].morph).not.toHaveBeenCalled();
        expect(getCurrentPosition).toHaveBeenCalledTimes(1);
        const list = await nearbyList();
        await waitFor(() =>
          expect(within(list).getByText(/· 0m$/)).toBeTruthy(),
        );
        expect(within(list).getByText("장소 1")).toBeTruthy();
        expect(within(list).queryByText("장소 3")).toBeNull();
        expect(within(list).queryByText(/역삼역/)).toBeNull();
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
          await waitFor(() => expect(mapState()).toBe("ready"));
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
          await waitFor(() => expect(mapState()).toBe("ready"));
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
            await waitFor(() => expect(mapState()).toBe("ready"));
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
          await waitFor(() => expect(mapState()).toBe("ready"));

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
        await waitFor(() => expect(mapState()).toBe("ready"));
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

      it("점수가 없는 카드는 핏 점수 없이 기준 지점(역삼역)에서 가까운 순으로 보인다", async () => {
        const far = { ...card(1), score: undefined };
        const near = {
          ...card(2),
          score: undefined,
          place: { ...card(2).place, lat: 37.5006, lng: 127.0364 },
        };
        stubNearbyItems([far, near]);
        renderScreen();
        await waitFor(() => expect(mapState()).toBe("ready"));
        const list = await nearbyList();

        const names = (await within(list).findAllByText(/^장소 \d$/)).map(
          (node) => node.textContent,
        );
        expect(names).toEqual(["장소 2", "장소 1"]);
        expect(within(list).queryByText("핏 점수")).toBeNull();
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
      await waitFor(() => expect(mapState()).toBe("ready"));

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

    // 인증 실패 알림은 모듈에 남으므로 그 테스트보다 먼저 둔다
    it("지도 SDK가 핀을 만들다 던지면(인증 실패 직후) 지도 영역이 비고 카드 목록은 동작한다", async () => {
      config.value = { env: "dev", naverMapClientId: "key" };
      const marker = vi.fn(() => {
        throw new TypeError(
          "Cannot read properties of null (reading 'LatLng')",
        );
      });
      stubNaverMaps({ Marker: marker });
      renderScreen();
      await waitFor(() => expect(mapState()).toBe("ready"));

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

    it("지도 인증이 실패하면(navermap_authFailure) 지도 영역이 비고 카드 목록은 동작한다", async () => {
      config.value = { env: "dev", naverMapClientId: "wrong-key" };
      renderScreen();

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

    it("위치를 얻으면 반경 안의 항목만 거리와 함께 보여 준다", async () => {
      stubGeolocation({ lat: 37.5, lng: 127.03 });
      renderScreen();

      const list = await newSearch("근처 카페");

      await waitFor(() =>
        expect(within(list).getAllByRole("listitem")).toHaveLength(1),
      );
      expect(within(list).getByText("장소 1")).toBeTruthy();
      expect(within(list).getByText(/· 0m$/)).toBeTruthy();
      expect(searchBodies[0]).toEqual({ query: "근처 카페" });
    });

    it("반경 안에 남는 항목이 없으면 지원 지역 안내를 보여 준다", async () => {
      stubGeolocation({ lat: 35.1, lng: 129.04 });
      renderScreen();

      await newSearch("근처 카페");

      expect(await screen.findByText("추천 장소가 없어요")).toBeTruthy();
      expect(
        screen.getByText(/지금은 강남역·역삼역·선릉역 근처만 추천해요/),
      ).toBeTruthy();
    });

    it("위치를 얻지 못하면 거르지 않고 지역 기준 안내를 보여 준다", async () => {
      stubGeolocation("denied");
      renderScreen();

      const list = await newSearch("근처 카페");

      await screen.findByText(
        "위치를 확인할 수 없어 지역 기준으로 보여 드려요",
      );
      expect(within(list).getAllByRole("listitem")).toHaveLength(2);
      expect(await screen.findByText("위치를 확인할 수 없어요")).toBeTruthy();
      expect(within(list).queryByText(/\d+m$/)).toBeNull();
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

    const rankedNames = (list: HTMLElement) =>
      within(list)
        .getAllByRole("listitem")
        .map((item) => within(item).getByText(/^장소 \d$/).textContent);

    it("점수가 없는 근처 결과는 위치에서 가까운 순으로 순위가 매겨진다", async () => {
      stubUnscoredNearby();
      // 역삼역 기준이면 2, 3, 1이고 이 위치 기준이면 1, 3, 2다. 위치를 기준으로 삼는지 가른다
      stubGeolocation({ lat: 37.508, lng: 127.03 });
      renderScreen();

      const list = await newSearch("근처 카페");

      await waitFor(() =>
        expect(within(list).getAllByRole("listitem")).toHaveLength(3),
      );
      expect(rankedNames(list)).toEqual(["장소 1", "장소 3", "장소 2"]);
    });

    it("위치 권한이 정해지지 않아 위치가 없으면 근처 응답을 받아도 위치를 묻지 않고, 안내 없이 거르지 않고 역삼역에서 가까운 순으로 보인다", async () => {
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
      expect(rankedNames(list)).toEqual(["장소 2", "장소 3", "장소 1"]);
      expect(
        screen.queryByText("위치를 확인할 수 없어 지역 기준으로 보여 드려요"),
      ).toBeNull();
      expect(screen.queryByText("위치를 확인하는 중")).toBeNull();
      expect(getCurrentPosition).not.toHaveBeenCalled();
      expect(stores.current.getSnapshot().location).toEqual({ status: "idle" });
    });

    it("위치를 얻지 못해도 점수가 없는 근처 결과는 역삼역에서 가까운 순이다", async () => {
      stubUnscoredNearby();
      stubGeolocation("denied");
      renderScreen();

      const list = await newSearch("근처 카페");

      await screen.findByText(
        "위치를 확인할 수 없어 지역 기준으로 보여 드려요",
      );
      expect(rankedNames(list)).toEqual(["장소 2", "장소 3", "장소 1"]);
    });
  });

  describe("검색 중", () => {
    // 검색 요청만 release()를 부를 때까지 붙잡는다
    function holdSearches() {
      const original = globalThis.fetch;
      const held: Array<() => void> = [];
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(async (input, init) => {
          if (String(input).includes("/search")) {
            await new Promise<void>((resolve) => held.push(resolve));
          }
          return original(input, init);
        }),
      );
      return held;
    }

    async function startFollowUp(text: string) {
      fireEvent.change(screen.getByRole("textbox", { name: "후속 조건" }), {
        target: { value: text },
      });
      fireEvent.click(screen.getByRole("button", { name: "보내기" }));
      await screen.findByText("요청을 이해하는 중");
    }

    it("첫 페이지를 받는 동안 단계 문구를 차례로 바꾸고, 3초가 지나면 '조금만 더 걸려요'로 바꾸며 후속 입력창을 막는다", async () => {
      renderScreen();
      await newSearch("역삼 카페");
      const held = holdSearches();
      await startFollowUp("더 조용하게");

      const input = screen.getByRole("textbox", { name: "후속 조건" });
      expect(input.hasAttribute("disabled")).toBe(true);
      expect(screen.queryByRole("button", { name: "최근 검색" })).toBeNull();
      expect(screen.queryByRole("button", { name: "검색 취소" })).toBeNull();
      expect(
        await screen.findByText("주변 장소를 찾는 중", {}, { timeout: 2500 }),
      ).toBeTruthy();
      expect(
        await screen.findByText("조금만 더 걸려요", {}, { timeout: 2500 }),
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: "검색 취소" })).toBeTruthy();

      held[0]();
      await waitFor(() => expect(input.hasAttribute("disabled")).toBe(false));
    });

    it("'검색 취소'를 누르면 요청을 끊고 이전 결과로 돌아간다", async () => {
      renderScreen();
      await newSearch("역삼 카페");
      holdSearches();
      await startFollowUp("더 조용하게");

      fireEvent.click(
        await screen.findByRole(
          "button",
          { name: "검색 취소" },
          { timeout: 3500 },
        ),
      );

      expect(
        await screen.findByRole("heading", { name: "“역삼 카페”" }),
      ).toBeTruthy();
      expect(screen.getByRole("list", { name: "추천 장소" })).toBeTruthy();
      expect(stores.current.getSnapshot().entries).toHaveLength(1);
    });

    it("첫 검색에서 '검색 취소'를 누르면 첫 화면으로 돌아간다", async () => {
      holdSearches();
      renderScreen();
      fireEvent.change(screen.getByRole("textbox", { name: "장소 검색" }), {
        target: { value: "역삼 카페" },
      });
      fireEvent.submit(screen.getByRole("search"));

      fireEvent.click(
        await screen.findByRole(
          "button",
          { name: "검색 취소" },
          { timeout: 3500 },
        ),
      );

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
      held[0]();
      await new Promise((resolve) => setTimeout(resolve, 50));

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
      held[0]();
      await new Promise((resolve) => setTimeout(resolve, 50));

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

    it("위치가 없으면 역삼역 기준 주변 카드를 보이고, 그 요청은 문장만 보내며 기록에 쌓지 않는다", async () => {
      renderScreen();

      const list = await nearbyList();

      expect(within(list).getByText("장소 1")).toBeTruthy();
      expect(within(list).getByText(/· 역삼역 \d+m$/)).toBeTruthy();
      expect(within(list).queryByText("장소 3")).toBeNull();
      expect(nearbyBodies).toEqual([{ query: NEARBY_QUERY }]);
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
    const isSearch = (url: string, body?: { query?: string }) =>
      url.includes("/search") && body?.query !== NEARBY_QUERY;

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

    // 연결 실패는 두 번 더 보낸 뒤(약 3초) 실패한다
    it("연결이 없어 추천을 받지 못하면 연결 안내를 보인다", async () => {
      renderScreen();
      await newSearch("역삼 카페");
      failRequests(isSearch, { times: 3, offline: true });

      sendFollowUp("더 조용하게");

      expect(
        await screen.findByText(
          "인터넷에 연결되어 있지 않아요",
          {},
          { timeout: 5000 },
        ),
      ).toBeTruthy();
      expect(
        screen.getByText("연결을 확인하고 다시 시도해 주세요."),
      ).toBeTruthy();
      expect(screen.queryByRole("list", { name: "추천 장소" })).toBeNull();
    }, 8000);

    it("주변 추천을 받지 못하면 카드 자리에 안내를 보이고, 다시 시도하면 카드를 보인다", async () => {
      failRequests((url, body) => body?.query === NEARBY_QUERY);
      renderScreen();

      expect(
        await screen.findByText("주변 추천을 불러오지 못했어요"),
      ).toBeTruthy();

      fireEvent.click(screen.getByRole("button", { name: "다시 시도" }));

      expect(await nearbyList()).toBeTruthy();
      expect(screen.queryByText("주변 추천을 불러오지 못했어요")).toBeNull();
    });

    // 연결 실패는 두 번 더 보낸 뒤(약 3초) 실패한다
    it("연결이 없어 주변 추천을 받지 못하면 검색창이 꺼지고 최근 검색 버튼이 없다", async () => {
      failRequests((url, body) => body?.query === NEARBY_QUERY, {
        times: 3,
        offline: true,
      });
      renderScreen();

      expect(
        await screen.findByText(
          "인터넷에 연결되어 있지 않아요",
          {},
          { timeout: 5000 },
        ),
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
    }, 8000);

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
    const NOTICE = "지금은 AI 추천을 쓸 수 없어 가게 이름·메뉴로 찾았어요";

    it("검색 결과가 대체 결과이고 카드가 있으면 목록 위에 안내가 보인다", async () => {
      aiFallback.search = true;
      renderScreen();

      await newSearch("역삼 카페");

      expect(screen.getByText(NOTICE)).toBeTruthy();
    });

    it("대체 결과가 아니면 검색 결과와 첫 화면에 안내가 없다", async () => {
      renderScreen();
      await nearbyList();
      expect(screen.queryByText(NOTICE)).toBeNull();

      await newSearch("역삼 카페");

      expect(screen.queryByText(NOTICE)).toBeNull();
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

    it("첫 화면 주변 카드가 대체 결과면 안내가 보이고 다시 그릴 때 새로 받는다", async () => {
      aiFallback.nearby = true;
      renderScreen();
      await nearbyList();
      expect(screen.getByText(NOTICE)).toBeTruthy();

      await newSearch("역삼 카페");
      fireEvent.click(screen.getByRole("button", { name: "새 검색" }));
      await nearbyList();

      // 캐시의 카드를 먼저 그리고 뒤에서 다시 받는다. 다른 테스트와 함께 돌아 느려도 기다린다
      await waitFor(() => expect(nearbyBodies).toHaveLength(2), {
        timeout: 5000,
      });
    });

    it("첫 화면 대체 결과도 창 포커스나 재연결로는 다시 받지 않는다", async () => {
      aiFallback.nearby = true;
      renderScreen();
      await nearbyList();

      act(() => {
        focusManager.setFocused(false);
        focusManager.setFocused(true);
        onlineManager.setOnline(false);
        onlineManager.setOnline(true);
      });

      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(nearbyBodies).toHaveLength(1);
      focusManager.setFocused(undefined);
    });
  });
});
