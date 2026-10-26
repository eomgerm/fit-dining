import { moods, priorities, purposes, type OnboardingAnswers } from "./answers";

export const ANSWERS_KEY = "fd.onboarding.answers.v1";
export const GUEST_KEY = "fd.guest.v1";
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
          ["polarity", "label"].includes(key),
        ) &&
        (taste.polarity === "LIKE" || taste.polarity === "DISLIKE") &&
        typeof taste.label === "string" &&
        taste.label.trim().length >= 1 &&
        taste.label.trim().length <= 20 &&
        !/\p{Cc}/u.test(taste.label.trim()),
    )
  );
}
export function clearAnswers() {
  try {
    sessionStorage.removeItem(ANSWERS_KEY);
  } catch {
    /* Storage may be disabled. */
  }
}
export function writeAnswers(answers: OnboardingAnswers) {
  try {
    if (validAnswers(answers))
      sessionStorage.setItem(ANSWERS_KEY, JSON.stringify(answers));
    else clearAnswers();
  } catch {
    clearAnswers();
  }
}
export function readAnswers(): OnboardingAnswers | undefined {
  try {
    const raw = sessionStorage.getItem(ANSWERS_KEY);
    if (raw === null) return;
    const value: unknown = JSON.parse(raw);
    if (validAnswers(value)) return value;
  } catch {
    /* Malformed or unavailable storage must not block signup. */
  }
  clearAnswers();
}
export function startAsGuest() {
  clearAnswers();
  try {
    localStorage.setItem(GUEST_KEY, "1");
  } catch {
    /* Continue without persistence. */
  }
}
export function isGuest() {
  try {
    return localStorage.getItem(GUEST_KEY) === "1";
  } catch {
    return false;
  }
}
