import { hasFlagCookie, setFlagCookie } from "@/shared/lib/flag-cookie";
import { moods, priorities, purposes, type OnboardingAnswers } from "./answers";

export const ANSWERS_KEY = "fd.onboarding.answers.v1";
// 예전 비회원 표시(localStorage). migrateLegacyGuest가 쿠키로 옮긴다
export const GUEST_KEY = "fd.guest.v1";
// 비회원 표시. 홈(/)이 첫 HTML부터 검색 홈을 고르도록 서버(next.config의 / rewrite)가 읽는다
export const GUEST_COOKIE = "fd_guest";
// 브라우저가 허용하는 쿠키 수명 상한(400일)
const GUEST_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function codes(value: unknown, allowed: readonly string[]): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((item) => typeof item === "string" && allowed.includes(item))
  );
}
export function validAnswers(value: unknown): value is OnboardingAnswers {
  if (
    !record(value) ||
    Object.keys(value).some(
      (key) => !["mood", "priorities", "purposes", "tastes"].includes(key),
    )
  )
    return false;
  return (
    (value.mood === null || moods.some((mood) => mood.id === value.mood)) &&
    codes(
      value.priorities,
      priorities.map((item) => item.id),
    ) &&
    codes(
      value.purposes,
      purposes.map((item) => item.id),
    ) &&
    Array.isArray(value.tastes) &&
    value.tastes.length <= 10 &&
    value.tastes.every(
      (taste) =>
        record(taste) &&
        Object.keys(taste).every((key) =>
          ["polarity", "label", "code"].includes(key),
        ) &&
        (taste.polarity === "LIKE" || taste.polarity === "DISLIKE") &&
        (taste.code === undefined ||
          taste.code === null ||
          typeof taste.code === "string") &&
        typeof taste.label === "string" &&
        taste.label.trim().length >= 1 &&
        taste.label.trim().length <= 20 &&
        !/\p{Cc}/u.test(taste.label.trim()),
    )
  );
}
export function clearAnswers() {
  try {
    localStorage.removeItem(ANSWERS_KEY);
  } catch {
    /* Storage may be disabled. */
  }
}
function hasAnswers(answers: OnboardingAnswers) {
  return (
    answers.mood !== null ||
    answers.priorities.length > 0 ||
    answers.purposes.length > 0 ||
    answers.tastes.length > 0
  );
}
export function writeAnswers(answers: OnboardingAnswers) {
  try {
    if (validAnswers(answers) && hasAnswers(answers))
      localStorage.setItem(ANSWERS_KEY, JSON.stringify(answers));
    else clearAnswers();
  } catch {
    clearAnswers();
  }
}
export function readAnswers(): OnboardingAnswers | undefined {
  try {
    const raw = localStorage.getItem(ANSWERS_KEY);
    if (raw === null) return;
    const value: unknown = JSON.parse(raw);
    if (validAnswers(value) && hasAnswers(value)) return value;
  } catch {
    /* Malformed or unavailable storage must not block signup. */
  }
  clearAnswers();
}
export function startAsGuest() {
  setFlagCookie(GUEST_COOKIE, GUEST_MAX_AGE_SECONDS);
}
export function isGuest() {
  return hasFlagCookie(GUEST_COOKIE);
}
// Safari·iOS(WebKit)는 JS로 심은 쿠키를 7일까지만 둔다. 화면을 열 때마다 다시 심어 7일을 새로 센다
export function renewGuest() {
  if (isGuest()) startAsGuest();
}
// 탈퇴하면 처음 온 사람처럼 홈(/)이 온보딩을 준다. 옛 표시도 지워 다시 옮겨지지 않게 한다
export function endGuest() {
  setFlagCookie(GUEST_COOKIE, 0);
  try {
    localStorage.removeItem(GUEST_KEY);
  } catch {
    /* 저장소를 못 쓰면 옛 표시도 읽지 못한다 */
  }
}
// localStorage에 옛 표시가 있으면 쿠키로 옮기고 true를 돌려준다. 쿠키를 쓰지 못하면 옛 표시를 남긴다
export function migrateLegacyGuest() {
  try {
    if (localStorage.getItem(GUEST_KEY) !== "1") return false;
  } catch {
    return false;
  }
  startAsGuest();
  if (!isGuest()) return false;
  try {
    localStorage.removeItem(GUEST_KEY);
  } catch {
    /* 쿠키로 옮겼으니 남아도 다시 옮길 뿐이다 */
  }
  return true;
}
