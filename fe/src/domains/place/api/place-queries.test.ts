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
      ...placeQueries.search("entry-1", request),
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
      ...placeQueries.search("entry-1", { query: "역삼 카페" }),
      pages: 3,
    });

    expect(data.pages).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("항목 id마다 다른 캐시에 둔다", () => {
    const request = { query: "역삼 카페" };
    expect(placeQueries.search("entry-1", request).queryKey).not.toEqual(
      placeQueries.search("entry-2", request).queryKey,
    );
  });
});
