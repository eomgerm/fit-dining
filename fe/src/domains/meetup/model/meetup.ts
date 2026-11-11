// 모임 API의 타입(docs/specs/meetup/spec.md 인터페이스). 값이 없는 속성은 응답에서 빠진다

export type MeetupCategory = "RESTAURANT" | "CAFE" | "BAR" | "ANY";
export type AreaKind = "STATION" | "DONG" | "POINT";
export type MeetupPhase = "WAITING" | "RESULT" | "VOTING" | "DECIDED";
export type MeetupRole = "HOST" | "PARTICIPANT" | "VIEWER";
export type MeetupAction =
  | "EDIT_INFO"
  | "EDIT_DATE"
  | "REMOVE_PROFILE"
  | "CALCULATE"
  | "OPEN_POLL"
  | "DECIDE"
  | "CLOSE_POLL"
  | "REOPEN_POLL"
  | "CHANGE_DECISION"
  | "CANCEL_DECISION"
  | "JOIN"
  | "EDIT_TASTE"
  | "VOTE"
  | "LINK_ACCOUNT";

// 역은 "역"을 뺀 이름(선릉), 동은 동 이름(역삼동)이다
export type MeetupArea = { kind: "STATION" | "DONG"; name: string };

export type MeetupQuestions = {
  mood: boolean;
  food: boolean;
  spicy: boolean;
  price: boolean;
};

export type MeetupCreateRequest = {
  area: MeetupArea;
  category: MeetupCategory;
  date?: string;
  time?: string;
  headcount?: number;
  description?: string;
};

export type MeetupCreateResponse = { code: string; questions: MeetupQuestions };

export type MeetupAreasResponse = { items: MeetupArea[] };

export type MeetupInfo = {
  area: { kind: AreaKind; name?: string };
  category: MeetupCategory;
  date?: string;
  time?: string;
  headcount?: number;
  description?: string;
  hostNickname?: string;
  // 모임을 열 수 있는 마지막 날(KST, "2026-11-21")
  expiresOn: string;
};

export type Mood = "QUIET" | "LIVELY" | "ANY";
export type FoodType = "KOREAN" | "JAPANESE" | "CHINESE" | "WESTERN" | "ASIAN";

// 모임 질문의 답. 모두 생략할 수 있고, 스냅숏에는 지금 보이는 질문의 답만 온다
export type Taste = {
  mood?: Mood;
  likeFoods?: FoodType[];
  avoidFoods?: FoodType[];
  noSpicy?: boolean;
  priceCap?: number;
  wantMenu?: string;
};

export type MeetupProfile = {
  id: number;
  name: string;
  // 아바타 색 번호(0~7)
  color: number;
  member: boolean;
  host: boolean;
  taste?: Taste;
  reflected: boolean;
};

export type MeetupSnapshot = {
  phase: MeetupPhase;
  afterMeetup: boolean;
  info: MeetupInfo;
  questions: MeetupQuestions;
  me: {
    role: MeetupRole;
    profileId?: number;
    signedIn: boolean;
    convertible?: boolean;
  };
  allowed: MeetupAction[];
  profiles: MeetupProfile[];
  // 인원을 정했고 남긴 수가 인원보다 적을 때만 온다
  pendingCount?: number;
};

export type ProfileCreateRequest = { name: string; taste?: Taste };
export type ProfileCreateResponse = { profileId: number };

// 409의 problem.type(urn:fitdining:meetup:<종류>)
export type MeetupConflict =
  "name-taken" | "full" | "already-joined" | "host-profile";

export const NAME_MAX = 10;
export const WANT_MENU_MAX = 20;
export const PRICE_CAP_MIN = 5_000;
export const PRICE_CAP_MAX = 100_000;
export const PRICE_CAP_STEP = 1_000;

export const FOOD_TYPES: FoodType[] = [
  "KOREAN",
  "JAPANESE",
  "CHINESE",
  "WESTERN",
  "ASIAN",
];

export const FOOD_LABELS: Record<FoodType, string> = {
  KOREAN: "한식",
  JAPANESE: "일식",
  CHINESE: "중식",
  WESTERN: "양식",
  ASIAN: "아시안",
};

// 내 프로필
export function myProfile(snapshot: MeetupSnapshot) {
  return snapshot.profiles.find(
    (profile) => profile.id === snapshot.me.profileId,
  );
}

export function hostProfile(snapshot: MeetupSnapshot) {
  return snapshot.profiles.find((profile) => profile.host);
}

export function profileBadge(profile: MeetupProfile) {
  if (profile.host) return "host" as const;
  return profile.member ? ("member" as const) : undefined;
}

export const CATEGORY_LABELS: Record<MeetupCategory, string> = {
  RESTAURANT: "식당",
  CAFE: "카페",
  BAR: "술집",
  ANY: "상관없어요",
};

export const CATEGORIES: MeetupCategory[] = [
  "RESTAURANT",
  "CAFE",
  "BAR",
  "ANY",
];

export const HEADCOUNT_MIN = 2;
export const HEADCOUNT_MAX = 8;
export const DESCRIPTION_MAX = 100;

// 화면에 보이는 지역 이름. 역은 "역"을 붙인다
export function areaLabel(area: { kind: AreaKind; name?: string }) {
  if (!area.name) return "";
  return area.kind === "STATION" ? `${area.name}역` : area.name;
}

// 형식이 틀린 코드는 서버에 묻지 않고 없는 링크로 본다(D-2)
export function isMeetupCode(code: string) {
  return /^[A-Za-z0-9_-]{22}$/.test(code);
}

export function meetupHref(code: string) {
  return `/m/${code}`;
}
