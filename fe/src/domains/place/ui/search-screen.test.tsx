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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "@/shared/api/query-client";
import type { RuntimeConfig } from "@/shared/lib/runtime-config";
import { ToastProvider } from "@/shared/ui/overlay/toast";

import type { PlaceCard, PlaceSearchResponse } from "../model/place-types";
import { NEARBY_QUERY } from "../model/search-request";
import { createSearchStore, type SearchStore } from "../model/search-store";
import { SearchScreen } from "./search-screen";

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
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

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

// 첫 요청은 conditions {area: "역삼"}, 후속 조건이면 changeSummary가 있다
function stubApi() {
  searchBodies = [];
  nearbyBodies = [];
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
        return Response.json({
          conditions: {},
          nearby: true,
          totalCount: 2,
          items: [card(1), far],
        } satisfies PlaceSearchResponse);
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
      return Response.json(response);
    }),
  );
}

function renderScreen() {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <ToastProvider>
        <SearchScreen />
      </ToastProvider>
    </QueryClientProvider>,
  );
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

async function followUp(text: string) {
  fireEvent.change(screen.getByRole("textbox", { name: "후속 조건" }), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: "보내기" }));
  await waitFor(() =>
    expect(screen.getByRole("heading", { name: `“${text}”` })).toBeTruthy(),
  );
}

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
    setSize: ReturnType<typeof vi.fn>;
    panTo: ReturnType<typeof vi.fn>;
  }[] = [];
  const maps = {
    Map: class {
      constructor() {
        created.push(this);
      }
      getBounds = () => ({
        getSW: () => latLng(BOUNDS.swLat, BOUNDS.swLng),
        getNE: () => latLng(BOUNDS.neLat, BOUNDS.neLng),
      });
      panTo = vi.fn();
      setSize = vi.fn();
      destroy() {}
    },
    LatLng: class {},
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

function stubGeolocationDenied() {
  vi.stubGlobal("navigator", {
    geolocation: {
      getCurrentPosition: (_: PositionCallback, error: PositionErrorCallback) =>
        error({ code: 1 } as GeolocationPositionError),
    },
  });
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

    it("위치를 얻지 못한 뒤에는 '새 검색' 뒤에도 첫 페이지 요청에 현재 지도 영역을 담는다", async () => {
      stubGeolocationDenied();
      renderScreen();
      await waitFor(() => expect(mapState()).toBe("ready"));
      await newSearch("근처 카페");
      await screen.findByText(
        "위치를 확인할 수 없어 지역 기준으로 보여 드려요",
      );

      fireEvent.click(screen.getByRole("button", { name: "새 검색" }));
      await newSearch("역삼 카페");
      await followUp("더 조용하게");

      expect(searchBodies[0].mapBounds).toBeUndefined();
      expect(searchBodies[1].mapBounds).toEqual(BOUNDS);
      expect(searchBodies[2].mapBounds).toEqual(BOUNDS);
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
        fireEvent.click(
          screen.getAllByRole("button", { name: "요청 기록" })[0],
        );
        const sheet = await screen.findByRole("dialog", { name: "요청 기록" });
        fireEvent.click(
          within(sheet).getAllByRole("button", { name: "결과 보기" })[0],
        );
        await waitFor(() => expect(regionButton()).toBeNull());

        map.fire("dragend");
        fireEvent.click(screen.getByRole("button", { name: "새 검색" }));
        await newSearch("강남 술집");
        expect(regionButton()).toBeNull();
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
        expect(getCurrentPosition).toHaveBeenCalledTimes(1);
        const list = await nearbyList();
        await waitFor(() =>
          expect(within(list).getByText(/· 0m$/)).toBeTruthy(),
        );
        expect(within(list).getByText("장소 1")).toBeTruthy();
        expect(within(list).queryByText("장소 3")).toBeNull();
        expect(within(list).queryByText(/역삼역/)).toBeNull();
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
        expect(push).toHaveBeenCalledWith("/place?id=2");
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

  it("'새 검색'은 결과와 조건을 비우고 위쪽 검색창으로 돌아가며 다음 요청에 previousConditions가 없다", async () => {
    renderScreen();
    await newSearch("역삼 카페");

    fireEvent.click(screen.getByRole("button", { name: "새 검색" }));
    expect(screen.queryByRole("list", { name: "추천 장소" })).toBeNull();
    await newSearch("강남 술집");

    expect(searchBodies.at(-1)).toEqual({ query: "강남 술집" });
  });

  it("요청 기록의 '결과 보기'는 네트워크 없이 그 결과를 보여 주고, '여기서 이어 검색' 뒤 후속은 그 요청의 conditions를 보낸다", async () => {
    renderScreen();
    await newSearch("역삼 카페");
    await followUp("더 조용하게");
    const requestCount = searchBodies.length;

    fireEvent.click(screen.getAllByRole("button", { name: "요청 기록" })[0]);
    const sheet = await screen.findByRole("dialog", { name: "요청 기록" });
    expect(within(sheet).getByText("역삼 카페")).toBeTruthy();
    expect(within(sheet).getByText("보는 중")).toBeTruthy();
    fireEvent.click(within(sheet).getByRole("button", { name: "결과 보기" }));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "“역삼 카페”" })).toBeTruthy(),
    );
    expect(
      within(screen.getByRole("list", { name: "추천 장소" })).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(2);
    expect(searchBodies).toHaveLength(requestCount);

    fireEvent.click(screen.getAllByRole("button", { name: "요청 기록" })[0]);
    const reopened = await screen.findByRole("dialog", { name: "요청 기록" });
    // 지금 보는 항목(첫 요청)에는 버튼이 없어, 버튼은 후속 "더 조용하게" 항목의 것 하나다
    fireEvent.click(
      within(reopened).getByRole("button", { name: "여기서 이어 검색" }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole("heading", { name: "“더 조용하게”" }),
      ).toBeTruthy(),
    );
    await followUp("카페 말고 식당");

    expect(searchBodies.at(-1)).toEqual({
      query: "카페 말고 식당",
      previousConditions: { area: "역삼", quiet: true },
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
    expect(push).toHaveBeenCalledWith("/place?id=2");
  });

  describe("근처 검색", () => {
    function stubGeolocation(result: { lat: number; lng: number } | "denied") {
      vi.stubGlobal("navigator", {
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
      await screen.findByText("주변 장소를 찾는 중");
    }

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
      expect(stores.current.getSnapshot().entries).toHaveLength(1);
    });

    it("'결과 보기'를 누르면 진행 중이던 요청의 결과가 늦게 와도 고른 결과를 유지한다", async () => {
      renderScreen();
      await newSearch("역삼 카페");
      await followUp("더 조용하게");
      const held = holdSearches();
      await startFollowUp("카페 말고 식당");
      await waitFor(() => expect(held).toHaveLength(1));

      fireEvent.click(screen.getAllByRole("button", { name: "요청 기록" })[0]);
      const sheet = await screen.findByRole("dialog", { name: "요청 기록" });
      fireEvent.click(within(sheet).getByRole("button", { name: "결과 보기" }));
      held[0]();
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(stores.current.getSnapshot().entries).toHaveLength(2);
      expect(screen.getByRole("heading", { name: "“역삼 카페”" })).toBeTruthy();
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

      fireEvent.click(screen.getAllByRole("button", { name: "요청 기록" })[0]);
      const sheet = await screen.findByRole("dialog", { name: "요청 기록" });
      fireEvent.click(within(sheet).getByRole("button", { name: "결과 보기" }));
      await waitFor(() =>
        expect(
          screen.getByRole("heading", { name: "“역삼 카페”" }),
        ).toBeTruthy(),
      );

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
      expect(push).toHaveBeenCalledWith("/place?id=1");
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
          "위치 권한이 꺼져 있어요. 브라우저 설정에서 허용해 주세요",
        ),
      ).toBeTruthy();
      expect(getCurrentPosition).not.toHaveBeenCalled();

      // 상세에 갔다가 돌아온 것처럼 다시 그린다
      cleanup();
      renderScreen();
      await nearbyList();
      expect(
        screen.queryByText(
          "위치 권한이 꺼져 있어요. 브라우저 설정에서 허용해 주세요",
        ),
      ).toBeNull();
    });

    it.each(["저장한 장소", "내 정보"])(
      "'%s' 버튼은 첫 화면과 결과 화면에서 '준비 중이에요'를 띄운다",
      async (name) => {
        renderScreen();
        fireEvent.click(screen.getByRole("button", { name }));
        expect(await screen.findByText("준비 중이에요")).toBeTruthy();

        await newSearch("역삼 카페");
        expect(screen.getByRole("button", { name })).toBeTruthy();
      },
    );

    describe("최근 검색", () => {
      async function openRecent() {
        fireEvent.click(screen.getByRole("button", { name: "최근 검색" }));
        return screen.findByRole("dialog", { name: "최근 검색" });
      }

      it("기록이 없으면 빈 안내를 보인다", async () => {
        renderScreen();

        const sheet = await openRecent();

        expect(
          within(sheet).getByText(
            "아직 검색한 요청이 없어요. 원하는 분위기나 목적을 말해 보세요.",
          ),
        ).toBeTruthy();
      });

      it("새 검색의 문장만 남아 다시 열어도 보이고, 누르면 그 문장으로 새 검색을 보낸다", async () => {
        renderScreen();
        await newSearch("역삼 카페");
        await followUp("더 조용하게");

        // 재로드처럼 화면 상태를 비우고 다시 연다
        cleanup();
        stores.current = createSearchStore();
        renderScreen();
        const sheet = await openRecent();

        expect(within(sheet).queryByText("더 조용하게")).toBeNull();
        expect(
          within(sheet).getByText(/^오늘 오[전후] \d+:\d\d$/),
        ).toBeTruthy();
        fireEvent.click(
          within(sheet).getByRole("button", { name: /역삼 카페/ }),
        );

        await waitFor(() =>
          expect(
            screen.getByRole("heading", { name: "“역삼 카페”" }),
          ).toBeTruthy(),
        );
        expect(searchBodies.at(-1)).toEqual({ query: "역삼 카페" });
        expect(stores.current.getSnapshot().entries).toHaveLength(1);
      });

      it("결과를 보는 중에 고르면 지금 보는 요청을 비우고 새 검색으로 보낸다", async () => {
        renderScreen();
        await newSearch("역삼 카페");
        await followUp("더 조용하게");

        const sheet = await openRecent();
        fireEvent.click(
          within(sheet).getByRole("button", { name: /역삼 카페/ }),
        );

        await waitFor(() =>
          expect(stores.current.getSnapshot().entries).toHaveLength(3),
        );
        expect(searchBodies.at(-1)).toEqual({ query: "역삼 카페" });
        expect(stores.current.getSnapshot().entries[2].kind).toBe("new");
        expect(screen.queryByText(/^추가 조건 ·/)).toBeNull();
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
});
