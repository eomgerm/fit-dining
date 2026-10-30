// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { bannerClosed, closeBanner, introSeen, markIntroSeen } from "./storage";

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("설치 안내 기록", () => {
  it("모달은 한 번 띄우면 다음 방문에도 본 것으로 남는다", () => {
    expect(introSeen()).toBe(false);
    markIntroSeen();
    expect(introSeen()).toBe(true);
    expect(localStorage.length).toBe(1);
  });

  it("배너는 이번 방문 동안만 닫힌다", () => {
    expect(bannerClosed()).toBe(false);
    closeBanner();
    expect(bannerClosed()).toBe(true);
    expect(sessionStorage.length).toBe(1);
    expect(localStorage.length).toBe(0);
  });

  it("저장소를 못 써도 이번 페이지 동안은 본 것·닫은 것으로 기억한다", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(introSeen()).toBe(false);
    expect(bannerClosed()).toBe(false);
    // 기억하지 못하면 [웹에서 계속하기]가 같은 버튼을 다시 눌러 안내가 끝없이 다시 뜬다
    expect(() => markIntroSeen()).not.toThrow();
    expect(() => closeBanner()).not.toThrow();
    expect(introSeen()).toBe(true);
    expect(bannerClosed()).toBe(true);
  });
});
