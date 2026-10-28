import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fetchReviews } from "./review-api";

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
