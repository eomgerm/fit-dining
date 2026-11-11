import { afterEach, describe, expect, it, vi } from "vitest";

import { createQueryClient } from "@/shared/api/query-client";

import { placeQueries } from "./place-queries";

afterEach(() => {
  vi.unstubAllGlobals();
});

// 부를 때마다 pages를 차례로 돌려준다
function stubSearch(pages: object[]) {
  let call = 0;
  const fetchMock = vi.fn<typeof fetch>(
    async () =>
      new Response(JSON.stringify(pages[call++]), {
        headers: { "Content-Type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("location", { search: "" });
  return fetchMock;
}

const page = (nextCursor?: string) => ({
  conditions: {},
  nearby: false,
  totalCount: 25,
  items: [],
  ...(nextCursor && { nextCursor }),
});

describe("placeQueries.search", () => {
  it("다음 페이지는 첫 요청 본문에 nextCursor만 더해 보낸다", async () => {
    const fetchMock = stubSearch([page("MjA"), page()]);
    const request = { query: "더 조용하게", previousConditions: { a: 1 } };

    const data = await createQueryClient().fetchInfiniteQuery({
      ...placeQueries.search("entry-1", "followUp", request),
      pages: 2,
    });

    expect(data.pages).toHaveLength(2);
    const bodies = fetchMock.mock.calls.map(([, init]) =>
      JSON.parse(String(init?.body)),
    );
    expect(bodies).toEqual([request, { ...request, cursor: "MjA" }]);
  });

  it("nextCursor가 없으면 다음 페이지를 부르지 않는다", async () => {
    const fetchMock = stubSearch([page()]);

    const data = await createQueryClient().fetchInfiniteQuery({
      ...placeQueries.search("entry-1", "new", { query: "역삼 카페" }),
      pages: 3,
    });

    expect(data.pages).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("항목 id마다 다른 캐시에 둔다", () => {
    const request = { query: "역삼 카페" };
    expect(placeQueries.search("entry-1", "new", request).queryKey).not.toEqual(
      placeQueries.search("entry-2", "new", request).queryKey,
    );
  });

  it("쿼리 키는 항목 id만으로 정해지고 종류와 요청은 들어가지 않는다", () => {
    expect(
      placeQueries.search("entry-1", "region", undefined).queryKey,
    ).toEqual(["places", "search", "entry-1"]);
  });

  it.each([
    ["new", "/api/v1/places/search"],
    ["followUp", "/api/v1/places/search"],
    ["region", "/api/v1/places/search/region"],
  ] as const)(
    "%s 항목은 첫 페이지와 다음 페이지 모두 %s로 보낸다",
    async (kind, url) => {
      const fetchMock = stubSearch([page("MjA"), page()]);
      const request =
        kind === "region"
          ? {
              query: "역삼 카페",
              conditions: {},
              mapBounds: { swLat: 1, swLng: 2, neLat: 3, neLng: 4 },
            }
          : { query: "역삼 카페" };

      await createQueryClient().fetchInfiniteQuery({
        ...placeQueries.search("entry-1", kind, request),
        pages: 2,
      });

      expect(fetchMock.mock.calls.map(([input]) => String(input))).toEqual([
        url,
        url,
      ]);
      expect(JSON.parse(String(fetchMock.mock.calls[1][1]?.body))).toEqual({
        ...request,
        cursor: "MjA",
      });
    },
  );

  it("실행 요청이 없는 기록(실행 불가)은 HTTP 없이 실패한다", async () => {
    const fetchMock = stubSearch([page()]);

    await expect(
      createQueryClient().fetchInfiniteQuery(
        placeQueries.search("entry-1", "region", undefined),
      ),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("placeQueries.nearby", () => {
  const area = { swLat: 37.491, swLng: 127.021, neLat: 37.51, neLng: 127.044 };

  it("쿼리 키는 정규화한 영역이고 본문은 키에 든 그 영역 객체 하나다(AC-65)", async () => {
    const fetchMock = stubSearch([page()]);
    const options = placeQueries.nearby(area);

    expect(options.queryKey).toEqual(["places", "nearby", area]);
    expect(options.queryKey[2]).toBe(area);
    await createQueryClient().fetchQuery(options);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/v1/places/nearby");
    expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({
      mapBounds: area,
    });
  });

  it("staleTime과 gcTime은 10분이고 AI 대체 응답만 staleTime 0이다(AC-66)", async () => {
    stubSearch([page()]);
    const options = placeQueries.nearby(area);
    expect(options.gcTime).toBe(600_000);
    const staleTime = options.staleTime as (query: {
      state: { data: unknown };
    }) => number;
    const client = createQueryClient();
    const data = await client.fetchQuery(options);
    expect(staleTime({ state: { data } })).toBe(600_000);
    expect(options.refetchOnWindowFocus).toBe(false);
    expect(options.refetchOnReconnect).toBe(false);
  });

  it("AI 대체 응답(X-Fallback: AI_UNAVAILABLE)은 staleTime 0이라 같은 key를 다시 보면 다시 받는다(AC-66)", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      Response.json(page(), { headers: { "X-Fallback": "AI_UNAVAILABLE" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("location", { search: "" });
    const options = placeQueries.nearby(area);
    const staleTime = options.staleTime as (query: {
      state: { data: unknown };
    }) => number;
    const client = createQueryClient();

    const data = await client.fetchQuery(options);
    expect(staleTime({ state: { data } })).toBe(0);
    await client.fetchQuery(placeQueries.nearby({ ...area }));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("받은 지 10분 전에는 다시 받지 않고, 10분이 지나면 같은 key로 다시 받는다(AC-66, AC-67)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      const fetchMock = stubSearch([page(), page()]);
      const client = createQueryClient();
      await client.fetchQuery(placeQueries.nearby(area));

      vi.advanceTimersByTime(600_000 - 1);
      await client.fetchQuery(placeQueries.nearby({ ...area }));
      expect(fetchMock).toHaveBeenCalledTimes(1);

      vi.advanceTimersByTime(2);
      await client.fetchQuery(placeQueries.nearby({ ...area }));
      expect(fetchMock).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("같은 영역 key의 fresh cache가 있으면 다시 받지 않는다(AC-66)", async () => {
    const fetchMock = stubSearch([page(), page()]);
    const client = createQueryClient();
    await client.fetchQuery(placeQueries.nearby(area));
    await client.fetchQuery(placeQueries.nearby({ ...area }));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
