import { FOOD_LABELS, type Mood, type Taste } from "./meetup";

const MOOD_SHORT: Record<Mood, string | null> = {
  QUIET: "조용한 곳",
  LIVELY: "활기찬 곳",
  ANY: null,
};

export const MOOD_LABELS: Record<Mood, string> = {
  QUIET: "조용하고 차분한 곳",
  LIVELY: "활기찬 곳",
  ANY: "상관없어요",
};

function foods(taste: Taste) {
  return taste.likeFoods?.length
    ? taste.likeFoods.map((food) => FOOD_LABELS[food]).join("·")
    : null;
}

function price(priceCap?: number) {
  if (!priceCap) return null;
  return priceCap % 10_000 === 0
    ? `${priceCap / 10_000}만 원 이하`
    : `${priceCap.toLocaleString("ko-KR")}원 이하`;
}

// 대기 화면 목록의 한 줄 요약. "조용한 곳 · 한식·양식 · 매운 건 못 먹어요 · 곱창"(AC-29). 답이 없으면 빈 목록이다
export function tasteSummary(taste?: Taste) {
  if (!taste) return [];
  return [
    taste.mood ? MOOD_SHORT[taste.mood] : null,
    foods(taste),
    taste.noSpicy ? "매운 건 못 먹어요" : null,
    price(taste.priceCap),
    taste.wantMenu ?? null,
  ].filter((part): part is string => !!part);
}

// 취향을 남긴 뒤 화면의 표. 분위기와 음식(먹고 싶은 음식, 빼고 싶은 음식, 매운 음식, 메뉴, 가격) 두 줄이다
export function tasteRows(taste?: Taste) {
  const food = [
    foods(taste ?? {}),
    taste?.avoidFoods?.length
      ? `${taste.avoidFoods.map((type) => FOOD_LABELS[type]).join("·")} 빼고`
      : null,
    taste?.noSpicy ? "매운 건 못 먹어요" : null,
    taste?.wantMenu ?? null,
    price(taste?.priceCap),
  ].filter((part): part is string => !!part);
  return [
    {
      label: "분위기",
      value: taste?.mood ? MOOD_LABELS[taste.mood] : "상관없어요",
    },
    { label: "음식", value: food.length ? food.join(" · ") : "상관없어요" },
  ];
}
