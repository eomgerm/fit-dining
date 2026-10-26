import { afterEach, describe, expect, it, vi } from "vitest";
import { analyzeTaste } from "./analyze-taste";
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
describe("가짜 취향 분석", () => {
  it("예문을 긍정과 부정으로 구분한다", async () => {
    vi.useFakeTimers();
    const pending = analyzeTaste("담백한 국물 좋아하고 너무 매운 건 별로예요", {
      signal: new AbortController().signal,
    });
    await vi.advanceTimersByTimeAsync(1200);
    expect(await pending).toEqual([
      { polarity: "like", label: "담백한 국물" },
      { polarity: "dislike", label: "매운맛" },
    ]);
  });
  it("키워드가 없어도 결과를 반환한다", async () => {
    vi.useFakeTimers();
    const pending = analyzeTaste("새로운 음식", {
      signal: new AbortController().signal,
    });
    await vi.advanceTimersByTimeAsync(1200);
    expect(await pending).toEqual([{ polarity: "like", label: "새로운 음식" }]);
  });
  it("개발 환경의 실패와 운영 환경의 성공을 구분한다", async () => {
    vi.useFakeTimers();
    vi.stubEnv("NODE_ENV", "development");
    const pending = analyzeTaste("#실패", {
      signal: new AbortController().signal,
    });
    const failure = expect(pending).rejects.toThrow("개발 환경");
    await vi.advanceTimersByTimeAsync(1200);
    await failure;
    vi.stubEnv("NODE_ENV", "production");
    const production = analyzeTaste("#실패", {
      signal: new AbortController().signal,
    });
    await vi.advanceTimersByTimeAsync(1200);
    expect((await production).length).toBeGreaterThan(0);
  });
  it("진행 중 또는 이미 취소된 signal을 처리한다", async () => {
    for (const alreadyAborted of [false, true]) {
      const controller = new AbortController();
      if (alreadyAborted) controller.abort();
      const pending = analyzeTaste("국물", { signal: controller.signal });
      const failure = expect(pending).rejects.toMatchObject({
        name: "AbortError",
      });
      controller.abort();
      await failure;
    }
  });
});
