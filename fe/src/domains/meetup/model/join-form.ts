import {
  NAME_MAX,
  PRICE_CAP_MAX,
  PRICE_CAP_MIN,
  PRICE_CAP_STEP,
  WANT_MENU_MAX,
  type FoodType,
  type MeetupQuestions,
  type Mood,
  type Taste,
} from "./meetup";

// 메뉴 가격 질문의 선택지. 1만·2만·3만 원, 직접 입력, 상관없음이다(D-17)
export const PRICE_PRESETS = [10_000, 20_000, 30_000] as const;
export type PriceChoice = (typeof PRICE_PRESETS)[number] | "custom" | "any";

export type JoinForm = {
  name: string;
  mood?: Mood;
  likeFoods: FoodType[];
  // "상관없어요" 칩. 고르면 먹고 싶은 음식을 비운다
  anyFood: boolean;
  // "빼고 싶은 음식 종류가 있어요"를 펼쳤는지. 접으면 고른 종류를 보내지 않는다
  avoidOpen: boolean;
  avoidFoods: FoodType[];
  noSpicy: boolean;
  wantMenu: string;
  price?: PriceChoice;
  // 직접 입력한 금액(숫자만)
  customPrice: string;
};

export const EMPTY_JOIN_FORM: JoinForm = {
  name: "",
  likeFoods: [],
  anyFood: false,
  avoidOpen: false,
  avoidFoods: [],
  noSpicy: false,
  wantMenu: "",
  customPrice: "",
};

const length = (text: string) => Array.from(text).length;

// 이름은 앞뒤 공백을 지운 값이 1~10자다(AC-5)
export function isNameValid(name: string) {
  const trimmed = name.trim();
  return trimmed.length > 0 && length(trimmed) <= NAME_MAX;
}

// 직접 입력 금액은 5천~10만 원, 1천 원 단위다(AC-6)
export function isPriceValid(value: string) {
  const amount = Number(value);
  return (
    /^\d+$/.test(value) &&
    amount >= PRICE_CAP_MIN &&
    amount <= PRICE_CAP_MAX &&
    amount % PRICE_CAP_STEP === 0
  );
}

export function canSubmit(
  form: JoinForm,
  questions: MeetupQuestions,
  withName: boolean,
) {
  if (withName && !isNameValid(form.name)) return false;
  if (questions.food && length(form.wantMenu.trim()) > WANT_MENU_MAX)
    return false;
  if (questions.price && form.price === "custom")
    return isPriceValid(form.customPrice);
  return true;
}

function priceCap(form: JoinForm) {
  if (form.price === undefined || form.price === "any") return undefined;
  return form.price === "custom" ? Number(form.customPrice) : form.price;
}

// 보이는 질문의 답만 보낸다. 보이지 않는 질문의 답은 서버도 저장하지 않는다(AC-6)
export function toTaste(form: JoinForm, questions: MeetupQuestions): Taste {
  const wantMenu = form.wantMenu.trim();
  return {
    ...(questions.mood && form.mood && { mood: form.mood }),
    ...(questions.food &&
      !form.anyFood &&
      form.likeFoods.length > 0 && { likeFoods: form.likeFoods }),
    ...(questions.food &&
      form.avoidOpen &&
      form.avoidFoods.length > 0 && { avoidFoods: form.avoidFoods }),
    ...(questions.food && wantMenu && { wantMenu }),
    ...(questions.spicy && form.noSpicy && { noSpicy: true }),
    ...(questions.price &&
      priceCap(form) !== undefined && { priceCap: priceCap(form) }),
  };
}

// 내 취향 수정은 남긴 답을 채운 질문지로 연다
export function formFromTaste(name: string, taste?: Taste): JoinForm {
  const cap = taste?.priceCap;
  const preset = PRICE_PRESETS.find((amount) => amount === cap);
  return {
    ...EMPTY_JOIN_FORM,
    name,
    mood: taste?.mood,
    likeFoods: taste?.likeFoods ?? [],
    avoidOpen: (taste?.avoidFoods?.length ?? 0) > 0,
    avoidFoods: taste?.avoidFoods ?? [],
    noSpicy: taste?.noSpicy ?? false,
    wantMenu: taste?.wantMenu ?? "",
    price: cap === undefined ? undefined : (preset ?? "custom"),
    customPrice: cap !== undefined && !preset ? String(cap) : "",
  };
}

const draftKey = (code: string) => `fitdining:meetup-join:${code}`;

// 질문지에서 로그인하러 갈 때 쓰던 답을 이 탭에만 둔다. 서버로 보내지 않는다(AC-28, D-21)
export function saveDraft(code: string, form: JoinForm) {
  try {
    sessionStorage.setItem(draftKey(code), JSON.stringify(form));
  } catch {}
}

// 남긴 답을 한 번 꺼내고 지운다
export function takeDraft(code: string): JoinForm | undefined {
  try {
    const raw = sessionStorage.getItem(draftKey(code));
    sessionStorage.removeItem(draftKey(code));
    return raw ? { ...EMPTY_JOIN_FORM, ...JSON.parse(raw) } : undefined;
  } catch {
    return undefined;
  }
}
