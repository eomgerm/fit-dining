// 추천 결과의 타입과 화면 문구(docs/specs/meetup/spec.md 결과, D-18). 값이 없는 속성은 응답에서 빠진다
import {
  areaLabel,
  CATEGORY_LABELS,
  FOOD_LABELS,
  type FoodType,
  type MeetupInfo,
  type MeetupProfile,
  type Mood,
} from "./meetup";
import { formatHour, formatWeekdayHour } from "./meetup-date";

export type OpenStatus =
  "OPEN" | "CLOSING_SOON" | "BREAK" | "CLOSED" | "UNKNOWN";

export type FitKind = "ALL" | "COUNT" | "MOSTLY" | "MISFIT";

export type ResultReason = {
  title: string;
  tags?: { source: "REQUEST" | "PREFERENCE"; label: string }[];
  quote?: string;
  quoteSource?: string;
};

// 장소 API의 장소 요약과 같은 모양이다
export type ResultPlace = {
  id: number;
  name: string;
  categoryGroup: "RESTAURANT" | "CAFE" | "BAR";
  station?: string;
  lat?: number;
  lng?: number;
  thumbnailUrl?: string;
};

export type MeetupResultItem = {
  rank: number;
  place: ResultPlace;
  // 모임 시각(없으면 지금)의 영업 상태
  openStatus?: OpenStatus;
  // 모임 점수. 점수를 매길 조건이 없으면 없다
  score?: number;
  group: "ALL_FIT" | "SOME_MISFIT";
  fit: {
    kind: FitKind;
    fitProfileIds: number[];
    misfitProfileIds?: number[];
    missedMenus?: { profileId: number; menu: string }[];
  };
  reasons: ResultReason[];
  caution?: string;
  menu?: { name: string; price?: number };
  facilities?: { group?: boolean; reservation?: boolean };
  distance?: { station?: string; walkMinutes?: number; meters?: number };
};

export type MeetupApplied = {
  mood?: Mood;
  likeFoods?: FoodType[];
  avoidFoods?: FoodType[];
  noSpicy?: boolean;
  priceCap?: number;
  wantMenus?: string[];
};

export type MeetupResult = {
  calculationId: number;
  calculatedAt: string;
  tasteCount: number;
  applied: MeetupApplied;
  items: MeetupResultItem[];
  emptyReason?: { cause: string; suggestion?: string; profileIds?: number[] };
};

const MOOD_CHIPS: Record<Mood, string | null> = {
  QUIET: "조용한 곳",
  LIVELY: "활기찬 곳",
  ANY: null,
};

function foods(types?: FoodType[]) {
  return types?.length
    ? types.map((type) => FOOD_LABELS[type]).join("·")
    : null;
}

function won(price: number) {
  return `${price.toLocaleString("ko-KR")}원`;
}

// 결과 위 조건 칩. "선릉역 · 식당 · 금 저녁 7시 영업 · 조용한 곳 · 한식·양식 선호 · 곱창 원해요 · 매운 음식 덜 추천"(AC-32)
export function conditionChips(info: MeetupInfo, applied: MeetupApplied) {
  const liked = foods(applied.likeFoods);
  const avoided = foods(applied.avoidFoods);
  return [
    areaLabel(info.area) || null,
    info.category === "ANY" ? null : CATEGORY_LABELS[info.category],
    info.date && info.time
      ? `${formatWeekdayHour(info.date, info.time)} 영업`
      : null,
    applied.mood ? MOOD_CHIPS[applied.mood] : null,
    liked ? `${liked} 선호` : null,
    avoided ? `${avoided} 빼고` : null,
    ...(applied.wantMenus ?? []).map((menu) => `${menu} 원해요`),
    applied.noSpicy ? "매운 음식 덜 추천" : null,
    applied.priceCap ? `메뉴 ${won(applied.priceCap)} 이하` : null,
  ].filter((chip): chip is string => !!chip);
}

// 받침이 있으면 "은", 없으면 "는". 한글이 아니면 "은"이다
export function topic(word: string) {
  const last = word.charCodeAt(word.length - 1);
  if (last < 0xac00 || last > 0xd7a3) return `${word}은`;
  return (last - 0xac00) % 28 === 0 ? `${word}는` : `${word}은`;
}

// 카드의 잘 맞는 사람 줄. 덜 맞는 사람이 원한 메뉴를 팔지 않으면 그 메뉴를 말한다(AC-32, D-18)
export function fitLine(
  fit: MeetupResultItem["fit"],
  profiles: MeetupProfile[],
) {
  const byId = new Map(profiles.map((profile) => [profile.id, profile]));
  const people = (ids: number[] = []) =>
    ids.flatMap((id) => byId.get(id) ?? []);
  if (fit.kind === "MISFIT") {
    const misfits = people(fit.misfitProfileIds);
    const missed = fit.missedMenus?.[0];
    const missedBy = missed && byId.get(missed.profileId);
    const text =
      misfits.length === 1 && missed && missedBy
        ? `${missedBy.name}님이 원한 ${topic(missed.menu)} 아니에요`
        : `${misfits.map((profile) => `${profile.name}님`).join(", ")} 취향과는 조금 달라요`;
    return { people: misfits, text, misfit: true };
  }
  const fits = people(fit.fitProfileIds);
  const text =
    fit.kind === "ALL"
      ? "모두에게 잘 맞아요"
      : fit.kind === "COUNT"
        ? `${fits.length}명에게 잘 맞아요`
        : "대체로 잘 맞아요";
  return { people: fits, text, misfit: false };
}

const OPEN_STATUS_NOW: Record<OpenStatus, string | null> = {
  OPEN: "영업 중",
  CLOSING_SOON: "곧 마감",
  BREAK: "브레이크타임",
  CLOSED: "영업 종료",
  UNKNOWN: null,
};

const OPEN_STATUS_AT: Record<OpenStatus, string | null> = {
  OPEN: "영업",
  CLOSING_SOON: "곧 마감",
  BREAK: "브레이크타임",
  CLOSED: "영업 안 해요",
  UNKNOWN: null,
};

// 영업 상태 글. 모임 날짜·시간이 있으면 그 시각 기준("저녁 7시 영업"), 없으면 지금 기준이다(AC-20)
export function openStatusLabel(status: OpenStatus, info: MeetupInfo) {
  if (info.date && info.time) {
    const label = OPEN_STATUS_AT[status];
    return label && `${formatHour(info.time)} ${label}`;
  }
  return OPEN_STATUS_NOW[status];
}

// 카드의 추천 이유 칩. 이유마다 붙은 짧은 근거 이름이고 두 개까지다
export function reasonChips(reasons: ResultReason[]) {
  const labels = reasons.flatMap((reason) =>
    reason.tags?.length ? reason.tags.map((tag) => tag.label) : [],
  );
  return [...new Set(labels)].slice(0, 2);
}

export function facilityChips(facilities: MeetupResultItem["facilities"]) {
  return [
    facilities?.group ? "단체 이용 가능" : null,
    facilities?.reservation ? "예약 가능" : null,
  ].filter((chip): chip is string => !!chip);
}

// "숙성 삼겹살 16,000원"
export function menuText(menu: NonNullable<MeetupResultItem["menu"]>) {
  return menu.price ? `${menu.name} ${won(menu.price)}` : menu.name;
}

// 카드 위 줄의 거리. "도보 4분" 또는 "350m"
export function distanceText(distance: MeetupResultItem["distance"]) {
  if (distance?.walkMinutes !== undefined)
    return `도보 ${distance.walkMinutes}분`;
  if (distance?.meters !== undefined)
    return distance.meters < 1000
      ? `${distance.meters}m`
      : `${(distance.meters / 1000).toFixed(1)}km`;
  return null;
}

export const PLACE_CATEGORY_LABELS: Record<
  ResultPlace["categoryGroup"],
  string
> = {
  RESTAURANT: "식당",
  CAFE: "카페",
  BAR: "술집",
};
