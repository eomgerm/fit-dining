// @vitest-environment jsdom
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeConfig } from "@/shared/lib/runtime-config";

import type { PlaceSearchResponse } from "../model/place-types";
import type { SearchStore } from "../model/search-store";
import { SEARCH_SLOW_MS, SEARCH_STEP_MS } from "./search-steps";
import { BOUNDS, stubNaverMaps } from "./testing/naver-maps-stub";
import {
  card,
  followUp,
  HERE,
  holdSearches,
  MAP_FAILED_DESCRIPTION,
  MAP_FAILED_TITLE,
  mapReady,
  mapState,
  nearbyBodies,
  nearbyList,
  newSearch,
  openHistory,
  pastView,
  releaseAndSettle,
  renderInNewPageSession,
  renderScreen,
  searchBodies,
  sendFollowUp,
  setUpSearchScreen,
  skeleton,
  stubLocation,
  stubLocationLater,
} from "./testing/search-screen-harness";

// SearchScreen의 지도를 쓸 수 없을 때, 결과 화면, 근처 검색, 검색 중, 다음 페이지. 공통 helper는 testing/search-screen-harness.tsx에 있다

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

setUpSearchScreen({ stores, config, push });

describe("SearchScreen", () => {
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
});
