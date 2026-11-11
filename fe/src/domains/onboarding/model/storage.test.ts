// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  ANSWERS_KEY,
  GUEST_KEY,
  clearAnswers,
  GUEST_COOKIE,
  isGuest,
  migrateLegacyGuest,
  renewGuest,
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
  document.cookie = `${GUEST_COOKIE}=; Path=/; Max-Age=0`;
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
it("코드 없는 좋아함 칩의 벡터를 함께 저장하고 읽는다", () => {
  const withVector: OnboardingAnswers = {
    ...answers,
    tastes: [
      { polarity: "LIKE", label: "창가 자리", vector: Array(1024).fill(0.5) },
    ],
  };
  writeAnswers(withVector);
  expect(readAnswers()).toEqual(withVector);
});
it.each([
  [Array(3).fill(0.5)],
  [[...Array(1023).fill(0.5), "x"]],
  [[...Array(1023).fill(0.5), null]],
])("모양이 틀린 칩 벡터가 있으면 저장값을 버린다", (vector) => {
  localStorage.setItem(
    ANSWERS_KEY,
    JSON.stringify({
      ...answers,
      tastes: [{ polarity: "LIKE", label: "창가 자리", vector }],
    }),
  );
  expect(readAnswers()).toBeUndefined();
});
// 서버(next.config의 / rewrite)가 읽도록 비회원 표시는 쿠키에 둔다
it("비회원은 답변을 유지하고 쿠키에 표시를 남긴다", () => {
  writeAnswers(answers);
  startAsGuest();
  expect(readAnswers()).toEqual(answers);
  expect(isGuest()).toBe(true);
  expect(document.cookie).toContain(`${GUEST_COOKIE}=1`);
  expect(localStorage.getItem(GUEST_KEY)).toBeNull();
});
it("localStorage에 남은 옛 비회원 표시를 한 번 쿠키로 옮긴다", () => {
  localStorage.setItem(GUEST_KEY, "1");

  expect(migrateLegacyGuest()).toBe(true);
  expect(isGuest()).toBe(true);
  expect(localStorage.getItem(GUEST_KEY)).toBeNull();
  expect(migrateLegacyGuest()).toBe(false);
});
// 쿠키를 막은 브라우저에서 옛 표시를 잃지 않는다
it("쿠키를 쓰지 못하면 옛 비회원 표시를 지우지 않는다", () => {
  localStorage.setItem(GUEST_KEY, "1");
  vi.spyOn(document, "cookie", "set").mockImplementation(() => {});

  expect(migrateLegacyGuest()).toBe(false);
  expect(localStorage.getItem(GUEST_KEY)).toBe("1");
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
  expect(migrateLegacyGuest()).toBe(false);
  // 비회원 표시는 쿠키라 저장소가 막혀도 남는다
  expect(isGuest()).toBe(true);
});

it.each(["FOOD_SPICY", null, undefined])("칩 코드를 보존한다: %s", (code) => {
  const value = {
    ...answers,
    tastes: [{ polarity: "LIKE" as const, label: "국물", code }],
  };
  writeAnswers(value);
  expect(readAnswers()).toEqual(JSON.parse(JSON.stringify(value)));
});
it.each([{ code: 42 }, { vector: [] }, { unknown: true }])(
  "잘못된 칩 속성을 거부한다: %j",
  (extra) => {
    localStorage.setItem(
      ANSWERS_KEY,
      JSON.stringify({
        ...answers,
        tastes: [{ polarity: "LIKE", label: "국물", ...extra }],
      }),
    );
    expect(readAnswers()).toBeUndefined();
  },
);

// Safari·iOS(WebKit)는 JS로 심은 쿠키를 7일까지만 둔다. 화면을 열 때마다 다시 심어 7일을 새로 센다
it("비회원이면 표시를 같은 수명으로 다시 심는다", () => {
  startAsGuest();
  const set = vi.spyOn(document, "cookie", "set");
  renewGuest();
  expect(set).toHaveBeenCalledWith(
    expect.stringContaining(
      `fd_guest=1; Path=/; Max-Age=${400 * 24 * 60 * 60};`,
    ),
  );
});

it("비회원이 아니면 표시를 심지 않는다", () => {
  const set = vi.spyOn(document, "cookie", "set");
  renewGuest();
  expect(set).not.toHaveBeenCalled();
  expect(isGuest()).toBe(false);
});
