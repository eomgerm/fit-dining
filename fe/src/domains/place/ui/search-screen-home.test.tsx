// @vitest-environment jsdom
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
  cleanup,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeConfig } from "@/shared/lib/runtime-config";

import type { PlaceSearchResponse } from "../model/place-types";
import { createSearchStore, type SearchStore } from "../model/search-store";
import { SEARCH_SLOW_MS } from "./search-steps";
import { BOUNDS, stubNaverMaps } from "./testing/naver-maps-stub";
import {
  AFTER_INITIAL_MOVE,
  card,
  clients,
  HERE,
  holdSearches,
  MAP_FAILED_TITLE,
  mapReady,
  mapState,
  nearbyBodies,
  nearbyList,
  newSearch,
  renderHideableScreen,
  renderScreen,
  searchBodies,
  setUpSearchScreen,
  skeleton,
  stubLocation,
  stubLocationLater,
  stubNearbyItems,
  typeSuggest,
} from "./testing/search-screen-harness";

// SearchScreen의 지도가 있을 때: 지도 시작 화면, 처음 이동, 위치 알림, 첫 화면, 홈 주변 카드. 공통 helper는 testing/search-screen-harness.tsx에 있다

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

    describe("지도 시작 화면 (D-108)", () => {
      const startView = () => {
        const { center, zoom } = map.created[0].options;
        return { lat: center.lat(), lng: center.lng(), zoom };
      };
      const savedView = () => localStorage.getItem("fd.map.view.v1");

      it("저장된 화면에서 시작하고, 멈출 때마다 지금 화면이 시작 화면과 다르면 그 화면을 저장한다", async () => {
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

      // 실제 SDK는 지도를 만들 때의 idle을 앱이 listener를 달기 전에 지나치거나 보내지 않는다(S15P31A302-228)
      it("지도를 만들 때 idle이 오지 않아도 사용자의 첫 끌기 뒤 idle에서 그 화면을 저장한다", async () => {
        renderScreen();
        await mapReady();
        const created = map.created[0];
        created.getCenter.mockReturnValue({
          lat: () => 37.51,
          lng: () => 127.05,
        });
        created.getZoom.mockReturnValue(15);
        map.fire("dragend");
        map.fire("idle");

        expect(JSON.parse(savedView()!)).toEqual({
          lat: 37.51,
          lng: 127.05,
          zoom: 15,
        });
      });

      it("지도를 만든 직후 idle이 와도 화면이 시작 화면 그대로(부동소수 오차 포함)면 저장하지 않는다", async () => {
        renderScreen();
        await mapReady();
        const created = map.created[0];
        const { lat, lng, zoom } = startView();
        created.getCenter.mockReturnValue({
          lat: () => lat + 1e-9,
          lng: () => lng - 1e-9,
        });
        created.getZoom.mockReturnValue(zoom);
        map.fire("idle");
        map.fire("idle");

        expect(savedView()).toBeNull();
      });

      it("처음 위치 panTo가 지도를 옮긴 뒤의 화면은 저장한다", async () => {
        stubLocation({ permission: "granted", position: HERE });
        renderScreen();
        await mapReady();
        await waitFor(() =>
          expect(map.created[0].panTo).toHaveBeenCalledTimes(1),
        );
        const created = map.created[0];
        created.getCenter.mockReturnValue({
          lat: () => HERE.lat,
          lng: () => HERE.lng,
        });
        map.fire("idle");

        expect(JSON.parse(savedView()!)).toEqual({ ...HERE, zoom: 15 });
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
          await typeSuggest(bar, "장소");
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
});
