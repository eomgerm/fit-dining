// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ANSWERS_KEY,
  GUEST_KEY,
  clearAnswers,
  isGuest,
  readAnswers,
  startAsGuest,
  writeAnswers,
} from "./storage";
import type { OnboardingAnswers } from "./answers";
const answers: OnboardingAnswers = {
  mood: "QUIET",
  priorities: ["COZY"],
  purposes: ["SOLO"],
  tastes: [{ polarity: "LIKE", label: "국물" }],
};
beforeEach(() => {
  sessionStorage.clear();
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());
it("답변을 읽고 쓰고 지운다", () => {
  writeAnswers(answers);
  expect(readAnswers()).toEqual(answers);
  clearAnswers();
  expect(readAnswers()).toBeUndefined();
});
it.each([
  "{",
  "null",
  JSON.stringify({ ...answers, mood: "calm" }),
  JSON.stringify({ ...answers, extra: true }),
  JSON.stringify({
    ...answers,
    tastes: [{ polarity: "LIKE", label: "a".repeat(21) }],
  }),
])("잘못된 저장값을 버린다: %s", (raw) => {
  sessionStorage.setItem(ANSWERS_KEY, raw);
  expect(readAnswers()).toBeUndefined();
  expect(sessionStorage.getItem(ANSWERS_KEY)).toBeNull();
});
it("비회원은 답변을 삭제하고 표시만 남긴다", () => {
  writeAnswers(answers);
  startAsGuest();
  expect(readAnswers()).toBeUndefined();
  expect(isGuest()).toBe(true);
  expect(localStorage.getItem(GUEST_KEY)).toBe("1");
  expect(localStorage.length).toBe(1);
});
it("저장소 예외가 흐름을 막지 않는다", () => {
  for (const method of ["getItem", "setItem", "removeItem"] as const)
    vi.spyOn(Storage.prototype, method).mockImplementation(() => {
      throw new Error("disabled");
    });
  expect(() => {
    writeAnswers(answers);
    clearAnswers();
    startAsGuest();
  }).not.toThrow();
  expect(readAnswers()).toBeUndefined();
  expect(isGuest()).toBe(false);
});
