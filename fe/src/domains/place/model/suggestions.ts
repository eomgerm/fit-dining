import type { PlaceSuggestion } from "./place-types";

// 후보 상자의 순서. "이 조건으로 추천받기"(ACTION)는 응답 안 위치와 상관없이 맨 위이고,
// 장소 후보는 응답 순서 그대로다(BE의 순서 규칙은 바꾸지 않는다)
export function actionFirst(suggestions: PlaceSuggestion[]) {
  return [
    ...suggestions.filter(({ type }) => type === "ACTION"),
    ...suggestions.filter(({ type }) => type !== "ACTION"),
  ];
}
