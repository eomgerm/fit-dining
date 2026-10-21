import { describe, expect, it } from "vitest";

import { ApiError } from "./api-error";
import { createQueryClient } from "./query-client";

// 매번 error를 던지는 쿼리를 돌리고 queryFn이 몇 번 불렸는지 센다
async function countAttempts(error: Error) {
  const queryClient = createQueryClient();
  let attempts = 0;
  await queryClient
    .fetchQuery({
      queryKey: ["test"],
      queryFn: () => {
        attempts += 1;
        throw error;
      },
      retryDelay: 0,
    })
    .catch(() => {});
  return attempts;
}

describe("createQueryClient", () => {
  it.each([
    ["HTTP 400", new ApiError("http", "fail", { status: 400 })],
    ["HTTP 404", new ApiError("http", "fail", { status: 404 })],
    ["HTTP 429", new ApiError("http", "fail", { status: 429 })],
    ["응답 파싱 실패", new SyntaxError("Unexpected token")],
  ])("%s 오류는 재시도하지 않는다", async (_label, error) => {
    expect(await countAttempts(error)).toBe(1);
  });

  it.each([
    ["HTTP 503", new ApiError("http", "fail", { status: 503 })],
    ["network", new ApiError("network", "fail")],
    ["timeout", new ApiError("timeout", "fail")],
  ])("%s 오류는 두 번까지 재시도한다", async (_label, error) => {
    expect(await countAttempts(error)).toBe(3);
  });
});
