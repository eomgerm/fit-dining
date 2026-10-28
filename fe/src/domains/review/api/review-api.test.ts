import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  deleteReview,
  fetchReview,
  fetchReviews,
  updateReview,
} from "./review-api";

const fetchMock = vi.fn();

function sentHeaders() {
  const init = fetchMock.mock.calls[0][1] as RequestInit;
  return new Headers(init.headers);
}

beforeEach(() => {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify({ items: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe("fetchReviews", () => {
  it("AT를 받으면 Authorization 헤더로 보낸다", async () => {
    await fetchReviews(3, undefined, undefined, "access");

    expect(sentHeaders().get("Authorization")).toBe("Bearer access");
  });

  it("AT가 없으면 Authorization 헤더를 보내지 않는다", async () => {
    await fetchReviews(3);

    expect(sentHeaders().has("Authorization")).toBe(false);
  });
});

describe("fetchReview", () => {
  it("내 리뷰를 AT와 취소 신호와 함께 GET으로 받는다", async () => {
    const signal = new AbortController().signal;

    await fetchReview(12, "access", signal);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/v1/reviews/12");
    expect(init.method).toBe("GET");
    expect(sentHeaders().get("Authorization")).toBe("Bearer access");
    expect(init.signal).toBeDefined();
  });
});

describe("updateReview", () => {
  it("본문을 PATCH로 AT와 함께 보내고 204를 받는다", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(
      updateReview(12, { description: "고친 본문" }, "access"),
    ).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/v1/reviews/12");
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe(JSON.stringify({ description: "고친 본문" }));
    expect(sentHeaders().get("Authorization")).toBe("Bearer access");
  });
});

describe("deleteReview", () => {
  it("DELETE를 AT와 함께 보낸다", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await deleteReview(12, "access");

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/v1/reviews/12");
    expect(init.method).toBe("DELETE");
    expect(sentHeaders().get("Authorization")).toBe("Bearer access");
  });
});
