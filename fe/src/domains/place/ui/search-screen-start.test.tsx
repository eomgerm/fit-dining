// @vitest-environment jsdom
import {
  focusManager,
  onlineManager,
  QueryClientProvider,
} from "@tanstack/react-query";
import {
  act,
  fireEvent,
  screen,
  waitFor,
  within,
  cleanup,
  render,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { RuntimeConfig } from "@/shared/lib/runtime-config";
import { ToastProvider } from "@/shared/ui/overlay/toast";

import { createSearchStore, type SearchStore } from "../model/search-store";
import { SearchScreen } from "./search-screen";
import { BOUNDS, stubNaverMaps } from "./testing/naver-maps-stub";
import {
  aiFallback,
  card,
  clients,
  followUp,
  guest,
  nearbyBodies,
  nearbyList,
  newClient,
  newSearch,
  openHistory,
  renderScreen,
  searchBodies,
  sendFollowUp,
  setUpSearchScreen,
  skeleton,
  stubLocation,
  typeSuggest,
} from "./testing/search-screen-harness";

// SearchScreen의 첫 화면, 최근 검색, 불러오기 실패, AI 대신 키워드로 찾은 결과. 공통 helper는 testing/search-screen-harness.tsx에 있다

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

    it("자동완성은 '이 조건으로 추천받기'를 맨 위에 두고, 입력한 단어마다 이름과 일치한 메뉴 이름에서 강조하며, 후보가 보이는 동안 막을 깔고 막을 누르면 닫히고, 입력을 지울 수 있다", async () => {
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
                { type: "PLACE", place: card(2).place },
                { type: "ACTION", label: "이 조건으로 추천받기" },
              ])
            : original(input, init),
        ),
      );
      renderScreen();
      const bar = screen.getByRole("textbox", { name: "장소 검색" });

      fireEvent.focus(bar);
      await typeSuggest(bar, "역삼 쌀국수");
      const list = await screen.findByRole("list", { name: "검색 추천" });

      expect(
        within(list)
          .getAllByRole("button")
          .map((row) => row.textContent),
      ).toEqual([
        "이 조건으로 추천받기",
        expect.stringContaining("하노이 쌀국수 역삼점"),
        expect.stringContaining("장소 2"),
      ]);
      // 이름에서는 두 단어가 각각, 메뉴 이름에서는 쌀국수가 강조된다. 일치하지 않는 이름에는 강조가 없다
      expect(
        Array.from(list.querySelectorAll("mark")).map(
          (mark) => mark.textContent,
        ),
      ).toEqual(["쌀국수", "역삼", "쌀국수"]);
      expect(screen.getByTestId("search-scrim")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "최근 검색" })).toBeNull();

      fireEvent.pointerDown(screen.getByTestId("search-scrim"));
      fireEvent.blur(bar);
      expect(screen.queryByRole("list", { name: "검색 추천" })).toBeNull();
      expect(screen.queryByTestId("search-scrim")).toBeNull();
      expect(bar).toHaveProperty("value", "역삼 쌀국수");

      fireEvent.click(screen.getByRole("button", { name: "입력 지우기" }));
      expect(bar).toHaveProperty("value", "");
      expect(screen.getByRole("button", { name: "최근 검색" })).toBeTruthy();
    });

    it("내 정보 버튼은 /my로 이동한다", () => {
      renderScreen();
      fireEvent.click(screen.getByRole("button", { name: "내 정보" }));
      expect(push).toHaveBeenCalledWith("/my");
    });
    // '저장한 장소' 버튼(첫 화면과 결과 화면, 비로그인 안내)은 saved-places.test.tsx가 본다

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
        // 검색 시각과 목록을 보는 시각이 자정을 사이에 두면 "오늘"이 아니다. Date만 정오로 고정하고 timer는 그대로 둔다
        vi.useFakeTimers({
          toFake: ["Date"],
          now: new Date("2026-11-12T12:00:00+09:00"),
        });
        // store는 만들 때의 Date.now를 시계로 쓰므로 고정한 뒤에 다시 만든다
        stores.current = createSearchStore();
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
        // setItem spy는 최상위 afterEach의 vi.restoreAllMocks()가 실패해도 되돌린다
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

      const bar = screen.getByRole("textbox", { name: "장소 검색" });
      fireEvent.focus(bar);
      await typeSuggest(bar, "역삼 쌀국수");

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

describe("홈 지도 왼쪽 위 자리 (meetup AC-67)", () => {
  it("첫 화면에 app이 넣은 버튼을 보인다", async () => {
    render(
      <QueryClientProvider client={newClient()}>
        <ToastProvider>
          <SearchScreen
            bookmarks={guest}
            topStart={<button type="button">모임 장소 정하기</button>}
          />
        </ToastProvider>
      </QueryClientProvider>,
    );
    expect(
      await screen.findByRole("button", { name: "모임 장소 정하기" }),
    ).toBeTruthy();
  });
});
