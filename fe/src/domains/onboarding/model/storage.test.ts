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
  localStorage.clear();
});
afterEach(() => vi.restoreAllMocks());
const emptyAnswers: OnboardingAnswers = {
  mood: null,
  priorities: [],
  purposes: [],
  tastes: [],
};
it("빈 답변을 저장하지 않고 이전 답변도 지운다", () => {
  writeAnswers(emptyAnswers);
  expect(localStorage.getItem(ANSWERS_KEY)).toBeNull();
  writeAnswers(answers);
  writeAnswers(emptyAnswers);
  expect(localStorage.getItem(ANSWERS_KEY)).toBeNull();
  expect(readAnswers()).toBeUndefined();
});
it("이전 버전이 남긴 빈 답변도 읽을 때 지운다", () => {
  localStorage.setItem(ANSWERS_KEY, JSON.stringify(emptyAnswers));
  expect(readAnswers()).toBeUndefined();
  expect(localStorage.getItem(ANSWERS_KEY)).toBeNull();
});
it.each([
  { ...emptyAnswers, mood: answers.mood },
  { ...emptyAnswers, priorities: answers.priorities },
  { ...emptyAnswers, purposes: answers.purposes },
  { ...emptyAnswers, tastes: answers.tastes },
])("한 항목만 있어도 답변을 유지한다: %j", (value) => {
  writeAnswers(value);
  expect(readAnswers()).toEqual(value);
});
it("답변을 읽고 쓰고 지운다", () => {
  writeAnswers(answers);
  expect(readAnswers()).toEqual(answers);
  expect(JSON.parse(localStorage.getItem(ANSWERS_KEY)!)).toEqual(answers);
  sessionStorage.clear();
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
  localStorage.setItem(ANSWERS_KEY, raw);
  expect(readAnswers()).toBeUndefined();
  expect(localStorage.getItem(ANSWERS_KEY)).toBeNull();
});
it("비회원은 답변을 유지하고 표시를 남긴다", () => {
  writeAnswers(answers);
  startAsGuest();
  expect(readAnswers()).toEqual(answers);
  expect(isGuest()).toBe(true);
  expect(localStorage.getItem(GUEST_KEY)).toBe("1");
  expect(localStorage.length).toBe(2);
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
