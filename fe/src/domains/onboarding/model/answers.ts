export const moods = [
  { id: "QUIET", label: "조용하고 차분한 곳" },
  { id: "LIVELY", label: "활기찬 곳" },
] as const;
export const priorities = [
  { id: "SPACIOUS", label: "자리가 넉넉한 곳" },
  { id: "SHORT_WAIT", label: "대기가 적은 곳" },
  { id: "GENEROUS_PORTION", label: "양이 충분한 곳" },
  { id: "PRETTY_SPACE", label: "공간이 예쁜 곳" },
  { id: "VIEW_OUTDOOR", label: "전망·야외가 좋은 곳" },
  { id: "COZY", label: "아늑한 곳" },
  { id: "VALUE", label: "가격만큼 만족스러운 곳" },
] as const;
export const purposes = [
  { id: "CONVERSATION", label: "대화하기 좋은 곳" },
  { id: "SOLO", label: "혼밥하기 좋은 곳" },
  { id: "DATE", label: "데이트·특별한 날" },
  { id: "GATHERING", label: "모임하기 좋은 곳" },
  { id: "WORK_STUDY", label: "작업·공부하기 좋은 곳" },
] as const;
export type TasteChip = {
  polarity: "LIKE" | "DISLIKE";
  label: string;
  code?: string | null;
  // 코드 없는 좋아함 칩의 문구 벡터(1024차원). 해석 API가 주고, 비회원 검색에 실어 취향 묶음 재료로 쓴다
  vector?: number[] | null;
};
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
