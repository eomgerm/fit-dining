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
