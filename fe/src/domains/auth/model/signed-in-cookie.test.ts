// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import {
  clearSignedIn,
  isMarkedSignedIn,
  markSignedIn,
  signedInMarks,
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

// 갱신 응답을 기다리는 사이 소셜 버튼이 새로 심은 표시를 늦게 온 401이 지우지 않는다
it("since 뒤에 새로 심은 표시는 지우지 않는다", () => {
  const since = signedInMarks();
  markSignedIn(Date.now() / 1000 + 600);

  clearSignedIn(since);
  expect(isMarkedSignedIn()).toBe(true);
});

it("since 뒤에 새로 심지 않았으면 지운다", () => {
  markSignedIn(Date.now() / 1000 + 600);
  const since = signedInMarks();

  clearSignedIn(since);
  expect(isMarkedSignedIn()).toBe(false);
});
