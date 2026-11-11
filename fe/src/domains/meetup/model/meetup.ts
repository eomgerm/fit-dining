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

export type MeetupProfile = {
  id: number;
  name: string;
  color: number;
  member: boolean;
  host: boolean;
};

export type MeetupSnapshot = {
  phase: MeetupPhase;
  afterMeetup: boolean;
  info: MeetupInfo;
  questions: MeetupQuestions;
  me: { role: MeetupRole; profileId?: number; signedIn: boolean };
  allowed: MeetupAction[];
  profiles: MeetupProfile[];
};

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
