// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  clearSignedIn,
  isMarkedSignedIn,
  markSignedIn,
} from "./signed-in-cookie";

afterEach(() => {
  clearSignedIn();
  vi.restoreAllMocks();
});

it("세션 만료(epoch 초)까지 남은 시간만큼 로그인 표시를 남긴다", () => {
  const set = vi.spyOn(document, "cookie", "set");
  const now = 1_700_000_000_000;
  markSignedIn(now / 1000 + 3600, now);

  expect(set).toHaveBeenCalledWith(
    expect.stringContaining("fd_signed_in=1; Path=/; Max-Age=3600;"),
  );
});

it("이미 만료된 세션이면 표시를 지운다", () => {
  markSignedIn(Date.now() / 1000 + 60);
  markSignedIn(Date.now() / 1000 - 1);

  expect(isMarkedSignedIn()).toBe(false);
});

it("clearSignedIn은 표시를 지운다", () => {
  markSignedIn(Date.now() / 1000 + 60);
  expect(isMarkedSignedIn()).toBe(true);

  clearSignedIn();
  expect(isMarkedSignedIn()).toBe(false);
});
