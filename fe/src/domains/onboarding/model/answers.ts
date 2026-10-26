export const moods = [
  { id: "calm", label: "조용하고 차분한 곳" },
  { id: "lively", label: "활기찬 곳" },
] as const;
export const priorities = [
  { id: "seating", label: "자리가 넉넉한 곳" },
  { id: "short-wait", label: "대기가 적은 곳" },
  { id: "portions", label: "양이 충분한 곳" },
  { id: "interior", label: "공간이 예쁜 곳" },
  { id: "view", label: "전망·야외가 좋은 곳" },
  { id: "cozy", label: "아늑한 곳" },
  { id: "value", label: "가격만큼 만족스러운 곳" },
] as const;
export const purposes = [
  { id: "conversation", label: "대화하기 좋은 곳" },
  { id: "solo", label: "혼밥하기 좋은 곳" },
  { id: "date", label: "데이트·특별한 날" },
  { id: "gathering", label: "모임하기 좋은 곳" },
  { id: "work", label: "작업·공부하기 좋은 곳" },
] as const;
export type TasteChip = { polarity: "like" | "dislike"; label: string };
export type OnboardingAnswers = {
  mood: (typeof moods)[number]["id"] | null;
  priorities: (typeof priorities)[number]["id"][];
  purposes: (typeof purposes)[number]["id"][];
  tastes: TasteChip[];
};
export function collectAnswers(answers: OnboardingAnswers): OnboardingAnswers {
  return {
    ...answers,
    priorities: [...answers.priorities],
    purposes: [...answers.purposes],
    tastes: answers.tastes.map((taste) => ({ ...taste })),
  };
}
export function canContinue(step: number, answers: OnboardingAnswers) {
  return step === 1
    ? answers.mood !== null
    : step === 2
      ? answers.priorities.length > 0
      : step === 3
        ? answers.purposes.length > 0
        : step === 4;
}
export function toggleSelection<T extends string>(items: T[], id: T): T[] {
  return items.includes(id)
    ? items.filter((item) => item !== id)
    : [...items, id];
}
