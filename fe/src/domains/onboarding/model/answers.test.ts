import { describe, expect, it } from "vitest";
import {
  canContinue,
  collectAnswers,
  toggleSelection,
  type OnboardingAnswers,
} from "./answers";
const empty: OnboardingAnswers = {
  mood: null,
  priorities: [],
  purposes: [],
  tastes: [],
};
describe("온보딩 답변", () => {
  it("1~3단계는 선택해야 하고 마지막 입력은 선택 사항이다", () => {
    for (const step of [1, 2, 3]) expect(canContinue(step, empty)).toBe(false);
    expect(canContinue(4, empty)).toBe(true);
    const selected: OnboardingAnswers = {
      ...empty,
      mood: "QUIET",
      priorities: ["COZY"],
      purposes: ["SOLO"],
    };
    for (const step of [1, 2, 3])
      expect(canContinue(step, selected)).toBe(true);
  });
  it("복수 선택을 토글하고 완료 답변은 원본과 분리한다", () => {
    expect(toggleSelection(["a"], "a")).toEqual([]);
    expect(toggleSelection(["a"], "b")).toEqual(["a", "b"]);
    const result = collectAnswers(empty);
    result.priorities.push("COZY");
    expect(empty.priorities).toEqual([]);
  });
});
