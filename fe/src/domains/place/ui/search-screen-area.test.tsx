// @vitest-environment jsdom
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeConfig } from "@/shared/lib/runtime-config";

import type { PlaceSearchResponse } from "../model/place-types";
import type { SearchStore } from "../model/search-store";
import { BOUNDS, stubNaverMaps } from "./testing/naver-maps-stub";
import {
  aiFallback,
  card,
  followUp,
  HERE,
  holdSearches,
  mapReady,
  nearbyBodies,
  nearbyList,
  newSearch,
  openHistory,
  pastView,
  releaseAndSettle,
  renderScreen,
  searchBodies,
  searchUrls,
  sendFollowUp,
  setUpSearchScreen,
  stubLocation,
  stubLocationLater,
} from "./testing/search-screen-harness";

// SearchScreen의 지도가 있을 때: 검색 지역과 결과 맞춤 이동, '이 지역에서 검색' 버튼. 공통 helper는 testing/search-screen-harness.tsx에 있다

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

      // conditions가 null이면 응답 conditions를 쓰는 규칙은 search-request.test.ts의 runnableRequest test가 본다
      it("새 모양 region 기록을 다시 검색하면 저장된 conditions로 region API를 부른다 (AC-57)", async () => {
        await openStoredThread(
          storedTurns({
            query: "강남역 파스타",
            conditions: { a: 1 },
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
          conditions: { a: 1 },
          mapBounds: BOUNDS,
        });
      });

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
  });
});
