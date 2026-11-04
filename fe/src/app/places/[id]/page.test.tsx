import { afterEach, describe, expect, it, vi } from "vitest";

import PlaceDetailPage from "./page";
import ReviewWritePage from "./review/page";
import ReviewEditPage from "./reviews/[reviewId]/edit/page";

// notFound()가 던지는 오류. 가장 가까운 not-found.tsx가 그려진다
const NOT_FOUND = { digest: "NEXT_HTTP_ERROR_FALLBACK;404" };

const fetchMock = vi.fn<typeof fetch>();
const noQuery = Promise.resolve({});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

function serve(status: number) {
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockImplementation(async () =>
    status === 200
      ? Response.json({ place: { id: 5, name: "카페 온담" } })
      : Response.json({ status }, { status }),
  );
}

function place(id: string, query: Record<string, string> = {}) {
  return PlaceDetailPage({
    params: Promise.resolve({ id }),
    searchParams: Promise.resolve(query),
  });
}

describe("장소 상세 페이지", () => {
  it.each(["0", "abc", "9007199254740992"])(
    "id가 %s면 BE에 묻지 않고 not-found다",
    async (id) => {
      serve(200);

      await expect(place(id)).rejects.toMatchObject(NOT_FOUND);
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it("BE가 404면 not-found다", async () => {
    serve(404);

    await expect(place("5")).rejects.toMatchObject(NOT_FOUND);
  });

  // 브라우저는 이 캐시로 곧바로 그리고, JS가 없어도 서버 HTML에 본문이 들어간다
  it("받은 상세를 캐시에 넣어 보낸다", async () => {
    serve(200);

    const page = await place("5");

    expect(page.props.state.queries).toMatchObject([
      {
        queryKey: ["places", "detail", 5],
        state: { data: { place: { name: "카페 온담" } } },
      },
    ]);
  });

  // 잠시 실패한 장소를 404로 만들면 검색 결과에서 빠진다. 화면은 브라우저가 다시 받는다
  it("BE가 실패하면 not-found 없이 캐시를 비워 화면을 그린다", async () => {
    serve(503);

    const page = await place("5");

    expect(page.props.state.queries).toEqual([]);
  });

  it("주소의 from=saved를 화면에 넘긴다", async () => {
    serve(200);

    const page = await place("5", { from: "saved" });

    expect(page.props.children.props).toEqual({ placeId: 5, fromSaved: true });
  });
});

describe("리뷰 작성·수정 페이지", () => {
  it("장소 id가 잘못되면 not-found다", async () => {
    await expect(
      ReviewWritePage({
        params: Promise.resolve({ id: "abc" }),
        searchParams: noQuery,
      }),
    ).rejects.toMatchObject(NOT_FOUND);
  });

  it("장소 id가 맞으면 작성 화면에 넘긴다", async () => {
    const page = await ReviewWritePage({
      params: Promise.resolve({ id: "3" }),
      searchParams: noQuery,
    });

    expect(page.props).toEqual({ placeId: 3 });
  });

  it.each([
    ["abc", "7"],
    ["3", "abc"],
  ])("장소 id %s, 리뷰 id %s면 not-found다", async (id, reviewId) => {
    await expect(
      ReviewEditPage({
        params: Promise.resolve({ id, reviewId }),
        searchParams: noQuery,
      }),
    ).rejects.toMatchObject(NOT_FOUND);
  });

  it("두 id가 맞으면 수정 화면에 넘긴다", async () => {
    const page = await ReviewEditPage({
      params: Promise.resolve({ id: "3", reviewId: "7" }),
      searchParams: noQuery,
    });

    expect(page.props).toEqual({ placeId: 3, reviewId: 7 });
  });
});
