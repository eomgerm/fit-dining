import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  followUpRequest,
  newSearchRequest,
  nextPageRequest,
  regionRequest,
  shouldSendMapBounds,
} from "../model/search-request";
import { createSearchStore } from "../model/search-store";
import {
  getPlace,
  isAiFallback,
  searchPlaces,
  showsAiFallback,
  suggestPlaces,
} from "./place-api";

const searchResponse = {
  conditions: { area: "역삼" },
  nearby: false,
  totalCount: 0,
  items: [],
};

let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

beforeEach(() => {
  fetchMock = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(searchResponse), {
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const sentHeaders = (call = 0) =>
  new Headers(fetchMock.mock.calls[call][1]?.headers);
const sentBody = (call = 0) => String(fetchMock.mock.calls[call][1]?.body);

describe("suggestPlaces", () => {
  it("GET /api/v1/places/suggest?q=로 부른다", async () => {
    await suggestPlaces("역삼 쌀국수");

    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/v1/places/suggest?q=%EC%97%AD%EC%82%BC+%EC%8C%80%EA%B5%AD%EC%88%98",
    );
  });
});

describe("getPlace", () => {
  it("GET /api/v1/places/{id}로 부른다", async () => {
    await getPlace(7);

    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/places/7");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("GET");
  });
});

describe("searchPlaces", () => {
  it("POST /api/v1/places/search로 본문을 보낸다", async () => {
    await expect(searchPlaces({ query: "역삼 카페" })).resolves.toEqual(
      searchResponse,
    );

    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/places/search");
    expect(fetchMock.mock.calls[0][1]?.method).toBe("POST");
    expect(JSON.parse(sentBody())).toEqual({ query: "역삼 카페" });
  });

  it("주소에 ?mock=empty가 있어도 어떤 요청에도 X-Mock-Scenario를 붙이지 않는다", async () => {
    vi.stubGlobal("location", { search: "?mock=empty" });

    await searchPlaces({ query: "역삼 카페" });
    await searchPlaces({ query: "역삼 카페", cursor: "MjA" });
    await suggestPlaces("역삼");
    await getPlace(1);

    for (const call of [0, 1, 2, 3]) {
      expect(sentHeaders(call).has("X-Mock-Scenario")).toBe(false);
    }
  });

  it("검색만 15초를 기다리고 자동완성과 상세는 10초다", async () => {
    const timeout = vi.spyOn(AbortSignal, "timeout");

    await searchPlaces({ query: "역삼 카페" });
    await searchPlaces({ query: "역삼 카페", cursor: "MjA" });
    await suggestPlaces("역삼");
    await getPlace(1);

    expect(timeout.mock.calls.map(([ms]) => ms)).toEqual([
      15_000, 15_000, 10_000, 10_000,
    ]);
    timeout.mockRestore();
  });

  it("넘긴 토큰은 Authorization으로, 비회원 답은 본문의 preferences로 싣는다", async () => {
    const preferences = {
      mood: null,
      priorities: ["SPACIOUS" as const],
      purposes: [],
      tastes: [{ polarity: "LIKE" as const, label: "창가 자리", code: null }],
    };

    await searchPlaces({ query: "카페" }, undefined, { accessToken: "at-1" });
    await searchPlaces({ query: "카페" }, undefined, { preferences });
    await searchPlaces({ query: "카페" });

    expect(sentHeaders(0).get("Authorization")).toBe("Bearer at-1");
    expect(JSON.parse(sentBody(0))).toEqual({ query: "카페" });
    expect(sentHeaders(1).has("Authorization")).toBe(false);
    expect(JSON.parse(sentBody(1))).toEqual({ query: "카페", preferences });
    expect(sentHeaders(2).has("Authorization")).toBe(false);
    expect(JSON.parse(sentBody(2))).toEqual({ query: "카페" });
  });

  it.each([
    ["AI_UNAVAILABLE", true],
    ["PREVIOUS_INVALID,AI_UNAVAILABLE", true],
    ["TASTE_INVALID", false],
    [null, false],
  ])("X-Fallback이 %s이면 대체 결과 여부가 %s다", async (value, expected) => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify(searchResponse), {
        headers: {
          "Content-Type": "application/json",
          ...(value && { "X-Fallback": value }),
        },
      }),
    );

    const response = await searchPlaces({ query: "카페" });

    expect(response).toEqual(searchResponse);
    expect(isAiFallback(response)).toBe(expected);
  });

  it("대체 결과라도 카드가 없으면 안내를 띄우지 않는다", async () => {
    const withCard = { ...searchResponse, totalCount: 1, items: [{}] };
    for (const body of [searchResponse, withCard]) {
      fetchMock.mockResolvedValueOnce(
        Response.json(body, { headers: { "X-Fallback": "AI_UNAVAILABLE" } }),
      );
    }

    const empty = await searchPlaces({ query: "카페" });
    const filled = await searchPlaces({ query: "카페" });

    expect(showsAiFallback(empty)).toBe(false);
    expect(showsAiFallback(filled)).toBe(true);
    expect(showsAiFallback(undefined)).toBe(false);
  });

  it("기기 위치를 얻었어도 어떤 검색 요청 본문에도 그 좌표가 없다", async () => {
    const store = createSearchStore();
    const here = { lat: 37.501234, lng: 127.039876 };
    store.setLocation({ status: "ok", here });
    const { regionLocked, location } = store.getSnapshot();
    const bounds = { swLat: 37.49, swLng: 127.02, neLat: 37.51, neLng: 127.04 };
    // 위치를 얻은 상태에서는 지도 영역도 담지 않는다
    expect(shouldSendMapBounds({ regionLocked, location })).toBe(false);

    const first = newSearchRequest("근처 카페");
    await searchPlaces(first);
    await searchPlaces(nextPageRequest(first, "MjA"));
    await searchPlaces(followUpRequest("더 조용하게", searchResponse));
    await searchPlaces(regionRequest(first, bounds));

    for (let call = 0; call < 4; call++) {
      const body = sentBody(call);
      expect(body).not.toContain(String(here.lat));
      expect(body).not.toContain(String(here.lng));
      expect(body).not.toMatch(/"(lat|lng|latitude|longitude)"/);
    }
  });
});
