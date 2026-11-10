import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  putPhoto,
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
  it("세션 쿠키를 사용하고 Authorization 헤더를 보내지 않는다", async () => {
    await fetchReviews(3, undefined, undefined);

    expect(sentHeaders().get("Authorization")).toBe(null);
  });

  it("AT가 없으면 Authorization 헤더를 보내지 않는다", async () => {
    await fetchReviews(3);

    expect(sentHeaders().has("Authorization")).toBe(false);
  });
});

describe("fetchReview", () => {
  it("내 리뷰를 AT와 취소 신호와 함께 GET으로 받는다", async () => {
    const signal = new AbortController().signal;

    await fetchReview(12, signal);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/v1/reviews/12");
    expect(init.method).toBe("GET");
    expect(sentHeaders().get("Authorization")).toBe(null);
    expect(init.signal).toBeDefined();
  });
});

describe("updateReview", () => {
  it("본문을 PATCH로 AT와 함께 보내고 204를 받는다", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(
      updateReview(12, { description: "고친 본문" }),
    ).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/v1/reviews/12");
    expect(init.method).toBe("PATCH");
    expect(init.body).toBe(JSON.stringify({ description: "고친 본문" }));
    expect(sentHeaders().get("Authorization")).toBe(null);
  });
});

describe("deleteReview", () => {
  it("DELETE를 AT와 함께 보낸다", async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    await deleteReview(12);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/api/v1/reviews/12");
    expect(init.method).toBe("DELETE");
    expect(sentHeaders().get("Authorization")).toBe(null);
  });
});

it("Garage PUT에는 CSRF 헤더를 붙이지 않는다", async () => {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
  const photo = new Blob(["photo"], { type: "image/jpeg" });
  const url = "/garage/pending/photo.jpg?signature=signed";
  await putPhoto(url, photo);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  const [sentUrl, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  expect(sentUrl).toBe(url);
  expect(init.method).toBe("PUT");
  expect(init.body).toBe(photo);
  expect(sentHeaders().has("X-XSRF-TOKEN")).toBe(false);
  expect([...sentHeaders().entries()]).toEqual([
    ["content-type", "image/jpeg"],
  ]);
});
