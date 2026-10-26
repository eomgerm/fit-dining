import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeTaste } from "./analyze-taste";
import { ApiError } from "@/shared/api/api-error";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/shared/api/client", () => ({ request: mocks.request }));
afterEach(() => vi.clearAllMocks());
describe("취향 분석 API", () => {
  it("입력과 취소 신호를 공통 API 클라이언트로 전달한다", async () => {
    const signal = new AbortController().signal;
    const tastes = [{ polarity: "LIKE", label: "국물" }];
    mocks.request.mockResolvedValueOnce({ tastes });
    expect(await analyzeTaste("국물", { signal })).toEqual(tastes);
    expect(mocks.request).toHaveBeenCalledWith(
      "/v1/onboarding/taste-analysis",
      {
        method: "POST",
        body: { text: "국물" },
        signal,
      },
    );
  });
  it.each([429, 503])("%s 오류를 화면으로 전달한다", async (status) => {
    const error = new ApiError("http", "실패", { status });
    mocks.request.mockRejectedValueOnce(error);
    await expect(
      analyzeTaste("국물", { signal: new AbortController().signal }),
    ).rejects.toBe(error);
  });
});
