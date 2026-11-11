// @vitest-environment jsdom
import { InfiniteQueryObserver, QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { AuthSession } from "@/domains/auth/api/auth-client";
import type { ApiError as ApiErrorClass } from "@/shared/api/api-error";

// 검색 요청(place-queries)과 app 계층의 연결을 함께 돌린다. auth-client와 BE 응답만 가짜다(place-ai-search AC-26).
// 세션 상태를 모듈에 두므로 테스트마다 새로 불러온다
const auth = vi.hoisted(() => ({
  session: null as AuthSession | null,
  restore: vi.fn<() => Promise<AuthSession>>(),
  checkSession: vi.fn<() => Promise<AuthSession>>(),
}));

vi.mock("@/domains/auth/api/auth-client", () => ({
  getSession: () => auth.session,
  restore: () => auth.restore(),
  checkSession: () => auth.checkSession(),
  clearSession: () => {
    auth.session = null;
  },
  subscribe: () => () => {},
}));

const session = (userId: string): AuthSession => ({
  userId,
  nickname: userId,
  sessionExpiresAt: 0,
});

const answers = {
  mood: "QUIET",
  priorities: ["SPACIOUS"],
  purposes: [],
  tastes: [{ polarity: "LIKE", label: "창가 자리", code: null }],
};

const searchResponse = {
  conditions: {},
  nearby: true,
  totalCount: 0,
  items: [],
};

let ApiError: typeof ApiErrorClass;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;

const sent = (call: number) => ({
  token: new Headers(fetchMock.mock.calls[call][1]?.headers).get(
    "Authorization",
  ),
  body: JSON.parse(String(fetchMock.mock.calls[call][1]?.body)),
});

async function load() {
  const { placeQueries, setSearchAccess } =
    await import("@/domains/place/api/place-queries");
  const { searchAccess } = await import("./search-access");
  setSearchAccess(searchAccess);
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return { placeQueries, queryClient };
}

beforeEach(async () => {
  vi.resetModules();
  ({ ApiError } = await import("@/shared/api/api-error"));
  auth.session = null;
  auth.restore.mockReset().mockImplementation(async () => {
    if (auth.session) return auth.session;
    throw new ApiError("http", "x", { status: 401 });
  });
  auth.checkSession.mockReset();
  localStorage.clear();
  fetchMock = vi.fn<typeof fetch>(async () => Response.json(searchResponse));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// 홈 주변 카드 요청의 정규화한 영역(spec 70번)
const AREA = { swLat: 37.491, swLng: 127.021, neLat: 37.51, neLng: 127.044 };

describe("검색 요청에 싣는 값", () => {
  it("확인된 회원이면 인증 헤더와 기기 답 없이 세션 쿠키로 보낸다", async () => {
    auth.session = session("user-1");
    localStorage.setItem("fd.onboarding.answers.v1", JSON.stringify(answers));
    const { placeQueries, queryClient } = await load();

    await queryClient.fetchQuery(placeQueries.nearby(AREA));

    expect(sent(0)).toEqual({
      token: null,
      body: { mapBounds: AREA },
    });
  });

  it("확인된 비회원이면 토큰 없이 기기의 온보딩 답을 preferences로 싣는다", async () => {
    localStorage.setItem("fd.onboarding.answers.v1", JSON.stringify(answers));
    const { placeQueries, queryClient } = await load();

    await queryClient.fetchQuery(placeQueries.nearby(AREA));

    expect(sent(0)).toEqual({
      token: null,
      body: { mapBounds: AREA, preferences: answers },
    });
  });

  it("비회원의 답이 없으면 preferences 없이 보낸다", async () => {
    const { placeQueries, queryClient } = await load();

    await queryClient.fetchQuery(placeQueries.nearby(AREA));

    expect(sent(0)).toEqual({ token: null, body: { mapBounds: AREA } });
  });

  it("비회원 답의 칩 code가 BE 규칙에 맞지 않으면 preferences 없이 보낸다", async () => {
    localStorage.setItem(
      "fd.onboarding.answers.v1",
      JSON.stringify({
        ...answers,
        tastes: [{ polarity: "LIKE", label: "조용한 곳", code: "quiet" }],
      }),
    );
    const { placeQueries, queryClient } = await load();

    await queryClient.fetchQuery(placeQueries.nearby(AREA));

    expect(sent(0)).toEqual({ token: null, body: { mapBounds: AREA } });
  });

  it("세션을 확인하지 못하면 토큰도 답도 싣지 않는다", async () => {
    auth.restore.mockRejectedValue(new ApiError("network", "x"));
    localStorage.setItem("fd.onboarding.answers.v1", JSON.stringify(answers));
    const { placeQueries, queryClient } = await load();

    await queryClient.fetchQuery(placeQueries.nearby(AREA));

    expect(sent(0)).toEqual({ token: null, body: { mapBounds: AREA } });
  });

  it("회원 세션이 만료돼 401이면 재시도 없이 비회원으로 전환한다", async () => {
    auth.session = session("user-1");
    auth.checkSession.mockImplementation(async () => {
      auth.session = session("user-1");
      return auth.session;
    });
    fetchMock.mockResolvedValueOnce(
      Response.json({ status: 401 }, { status: 401 }),
    );
    const { placeQueries, queryClient } = await load();

    await expect(
      queryClient.fetchQuery(placeQueries.nearby(AREA)),
    ).rejects.toMatchObject({ status: 401 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sent(0).token).toBe(null);
    expect(auth.checkSession).not.toHaveBeenCalled();
  });

  it("검색과 다음 페이지도 같은 규칙으로 싣고, 캐시의 요청에는 preferences가 없다", async () => {
    localStorage.setItem("fd.onboarding.answers.v1", JSON.stringify(answers));
    fetchMock.mockImplementation(async () =>
      Response.json({ ...searchResponse, nextCursor: "MjA" }),
    );
    const { placeQueries, queryClient } = await load();
    const request = { query: "역삼 카페" };
    const options = placeQueries.search("entry-1", "new", request);

    await queryClient.fetchInfiniteQuery(options);
    await new InfiniteQueryObserver(queryClient, options).fetchNextPage();

    expect(sent(0).body).toEqual({ query: "역삼 카페", preferences: answers });
    expect(sent(1).body).toEqual({
      query: "역삼 카페",
      cursor: "MjA",
      preferences: answers,
    });
    expect(request).toEqual({ query: "역삼 카페" });
  });
});
