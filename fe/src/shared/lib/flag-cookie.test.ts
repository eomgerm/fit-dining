// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { hasFlagCookie, setFlagCookie } from "./flag-cookie";

afterEach(() => {
  setFlagCookie("fd_test", 0);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("심은 표시를 읽고, 0초로 심으면 지운다", () => {
  setFlagCookie("fd_test", 600);
  expect(hasFlagCookie("fd_test")).toBe(true);

  setFlagCookie("fd_test", 0);
  expect(hasFlagCookie("fd_test")).toBe(false);
});

it("이름이 겹치는 다른 쿠키는 표시로 보지 않는다", () => {
  document.cookie = "fd_test_other=1; Path=/";
  document.cookie = "fd_test=10; Path=/";
  expect(hasFlagCookie("fd_test")).toBe(false);
  document.cookie = "fd_test_other=; Path=/; Max-Age=0";
});

// 다른 사이트 링크로 들어온 첫 요청에도 실리도록 Lax, 앱 전체에서 읽도록 Path=/
it("Path=/, SameSite=Lax로 심고, 남은 시간은 초 단위 정수다", () => {
  const set = vi.spyOn(document, "cookie", "set");
  setFlagCookie("fd_test", 599.7);
  expect(set).toHaveBeenCalledWith(
    "fd_test=1; Path=/; Max-Age=599; SameSite=Lax",
  );
});

it("https에서만 Secure를 붙인다", () => {
  const set = vi.spyOn(document, "cookie", "set");
  vi.stubGlobal("location", { protocol: "https:" });
  setFlagCookie("fd_test", 60);
  expect(set).toHaveBeenCalledWith(
    "fd_test=1; Path=/; Max-Age=60; SameSite=Lax; Secure",
  );
});
