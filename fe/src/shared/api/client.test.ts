import { afterEach, describe, expect, it, vi } from "vitest";

import { ApiError, isApiError } from "./api-error";
import { request } from "./client";

function stubFetch(response: Response) {
  const fetchMock = vi.fn<typeof fetch>(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function json(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("request", () => {
  it("GET 요청을 /api 아래로 보내고 JSON 본문을 돌려준다", async () => {
    const fetchMock = stubFetch(json({ id: "p1" }));

    const result = await request<{ id: string }>("/v1/places", {
      query: { q: "카페", page: 2, open: true, skip: undefined },
    });

    expect(result).toEqual({ id: "p1" });
    expect(fetchMock.mock.calls[0][0]).toBe(
      "/api/v1/places?q=%EC%B9%B4%ED%8E%98&page=2&open=true",
    );
    expect(fetchMock.mock.calls[0][1]?.method).toBe("GET");
  });

  // 서버 컴포넌트에는 같은 출처가 없어 상대 경로를 쓸 수 없다(design.md 12.5 #2)
  it("Next 서버에서는 BE_INTERNAL_URL 아래의 /api로 보낸다", async () => {
    vi.stubEnv("NEXT_RUNTIME", "nodejs");
    vi.stubEnv("BE_INTERNAL_URL", "http://caddy:8081");
    const fetchMock = stubFetch(json({ id: "p1" }));

    await request("/v1/places/1");

    expect(fetchMock.mock.calls[0][0]).toBe(
      "http://caddy:8081/api/v1/places/1",
    );
  });

  it("body를 JSON 문자열로 보내고 Content-Type을 붙인다", async () => {
    const fetchMock = stubFetch(json({ ok: true }, { status: 201 }));

    await request("/v1/reviews", {
      method: "POST",
      body: { rating: 5, text: "좋아요" },
    });

    const init = fetchMock.mock.calls[0][1];
    expect(init?.method).toBe("POST");
    expect(init?.body).toBe('{"rating":5,"text":"좋아요"}');
    expect(new Headers(init?.headers).get("Content-Type")).toBe(
      "application/json",
    );
  });

  it("204 응답은 undefined를 돌려준다", async () => {
    stubFetch(new Response(null, { status: 204 }));

    await expect(
      request("/v1/reviews/r1", { method: "DELETE" }),
    ).resolves.toBeUndefined();
  });

  it("ProblemDetail 오류 응답을 ApiError(http)로 던진다", async () => {
    stubFetch(
      new Response(
        JSON.stringify({
          type: "about:blank",
          title: "Bad Request",
          status: 400,
          detail: "검색어가 너무 깁니다",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/problem+json" },
        },
      ),
    );

    const error = await request("/v1/places").catch((e: unknown) => e);

    expect(isApiError(error)).toBe(true);
    expect(error).toMatchObject({
      kind: "http",
      status: 400,
      message: "검색어가 너무 깁니다",
      problem: { title: "Bad Request", detail: "검색어가 너무 깁니다" },
    });
  });

  it("JSON이 아닌 오류 응답은 problem 없이 status만 담는다", async () => {
    stubFetch(
      new Response("<html>Bad Gateway</html>", {
        status: 502,
        headers: { "Content-Type": "text/html" },
      }),
    );

    const error = await request("/v1/places").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      kind: "http",
      status: 502,
      message: "HTTP 502",
    });
    expect((error as ApiError).problem).toBeUndefined();
  });

  it("호출자가 준 헤더를 함께 보낸다", async () => {
    const fetchMock = stubFetch(json({}));

    await request("/v1/places", { headers: { "X-Mock-Scenario": "empty" } });

    const headers = new Headers(fetchMock.mock.calls[0][1]?.headers);
    expect(headers.get("X-Mock-Scenario")).toBe("empty");
  });

  it("fetch가 연결에 실패하면 ApiError(network)를 던진다", async () => {
    const cause = new TypeError("Failed to fetch");
    vi.stubGlobal(
      "fetch",
      vi.fn<typeof fetch>(async () => {
        throw cause;
      }),
    );

    const error = await request("/v1/places").catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ kind: "network", cause });
  });

  it("body를 직렬화하지 못하면 network가 아니라 원래 오류를 던진다", async () => {
    const fetchMock = stubFetch(json({}));
    const circular: Record<string, unknown> = {};
    circular.self = circular;

    const error = await request("/v1/reviews", {
      method: "POST",
      body: circular,
    }).catch((e: unknown) => e);

    expect(isApiError(error)).toBe(false);
    expect(error).toBeInstanceOf(TypeError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  describe("중단", () => {
    // 실제 fetch처럼 signal이 중단되면 signal.reason으로 reject한다
    function stubHangingFetch() {
      vi.stubGlobal(
        "fetch",
        vi.fn<typeof fetch>(
          (_input, init) =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () =>
                reject(init.signal?.reason),
              );
            }),
        ),
      );
    }

    it("timeoutMs가 지나면 ApiError(timeout)를 던진다", async () => {
      stubHangingFetch();

      const error = await request("/v1/places", { timeoutMs: 10 }).catch(
        (e: unknown) => e,
      );

      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ kind: "timeout" });
    });

    it("호출자가 취소하면 AbortError를 그대로 던진다", async () => {
      stubHangingFetch();
      const controller = new AbortController();

      const pending = request("/v1/places", { signal: controller.signal });
      controller.abort();
      const error = await pending.catch((e: unknown) => e);

      expect(isApiError(error)).toBe(false);
      expect((error as Error).name).toBe("AbortError");
    });

    // Next 16 기본 대상인 Safari 16.4, Chrome 111에는 AbortSignal.any가 없다
    it("AbortSignal.any가 없어도 호출자 취소가 동작한다", async () => {
      stubHangingFetch();
      vi.spyOn(AbortSignal, "any").mockImplementation(() => {
        throw new TypeError("AbortSignal.any is not a function");
      });
      const controller = new AbortController();

      const pending = request("/v1/places", { signal: controller.signal });
      controller.abort();
      const error = await pending.catch((e: unknown) => e);

      expect((error as Error).name).toBe("AbortError");
    });

    it("오류 본문을 읽는 중에 취소되면 AbortError를 그대로 던진다", async () => {
      const response = json({ status: 500 }, { status: 500 });
      response.json = () =>
        Promise.reject(new DOMException("aborted", "AbortError"));
      stubFetch(response);

      const error = await request("/v1/places").catch((e: unknown) => e);

      expect(isApiError(error)).toBe(false);
      expect((error as Error).name).toBe("AbortError");
    });
  });
});

it("Next 서버의 상태 변경 요청에는 CSRF 발급과 헤더를 넣지 않는다", async () => {
  vi.stubEnv("NEXT_RUNTIME", "nodejs");
  vi.stubEnv("BE_INTERNAL_URL", "http://caddy:8081");
  const fetchMock = stubFetch(new Response(null, { status: 204 }));
  await request("/v1/example", { method: "POST", body: { value: 1 } });
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(fetchMock.mock.calls[0][0]).toBe("http://caddy:8081/api/v1/example");
  expect(
    new Headers(fetchMock.mock.calls[0][1]?.headers).has("X-XSRF-TOKEN"),
  ).toBe(false);
});
