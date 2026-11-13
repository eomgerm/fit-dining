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

// 모임 지점의 반경(m, AC-58)
export type MeetupRadius = 500 | 1000 | 2000 | 5000;

// 역은 "역"을 뺀 이름(선릉), 동은 동 이름(역삼동)이다. 지점은 지도에서 고른 곳과 반경이고 이름은 위치 이름이다
export type MeetupArea =
  | { kind: "STATION" | "DONG"; name: string }
  | {
      kind: "POINT";
      name?: string;
      lat: number;
      lng: number;
      radiusM: MeetupRadius;
    };

// 지점과 반경 안의 장소 수와 붙일 이름("역삼동 근처"). 장소가 없으면 이름이 없다
export type MeetupAreaCheck = { placeCount: number; name?: string };

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

// 모임 정보 수정. 빠진 속성은 그대로 두고 null인 속성은 비운다(AC-22)
export type MeetupUpdateRequest = {
  area?: MeetupArea;
  category?: MeetupCategory;
  date?: string | null;
  time?: string | null;
  headcount?: number | null;
  description?: string | null;
};

export type MeetupAreasResponse = { items: MeetupArea[] };

export type MeetupInfo = {
  // 지점 모임만 지점과 반경이 있다
  area: {
    kind: AreaKind;
    name?: string;
    lat?: number;
    lng?: number;
    radiusM?: number;
  };
  category: MeetupCategory;
  date?: string;
  time?: string;
  headcount?: number;
  description?: string;
  hostNickname?: string;
  // 모임을 열 수 있는 마지막 날(KST, "2026-11-21")
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

// 링크 미리보기용 모임 정보(AC-66). 질문, 취향, 참여자 이름은 없다
export type MeetupPreview = {
  hostNickname?: string;
  area: { kind: AreaKind; name?: string };
  date?: string;
  time?: string;
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
    // 내 취향이 마지막 추천에 들어갔는지. 프로필이 있을 때만 온다
    tasteReflected?: boolean;
    convertible?: boolean;
  };
  allowed: MeetupAction[];
  profiles: MeetupProfile[];
  // 인원을 정했고 남긴 수가 인원보다 적을 때만 온다
  pendingCount?: number;
  // 가장 최근 계산. 추천받은 적이 없으면 없다
  calculation?: MeetupCalculation;
  // 마지막으로 성공한 계산. 결과는 이 값이 바뀔 때만 다시 받는다(D-9)
  resultCalculationId?: number;
  // 투표. 연 적이 없으면 없다
  poll?: MeetupPoll;
  // 정한 곳. 없으면 없다
  decision?: MeetupDecision;
};

// 투표(AC-38, AC-39). 익명 투표에는 voters와 notVoted가 없고, myVote는 그 표를 던진 브라우저나 그 회원에게만 온다
export type MeetupPoll = {
  state: "OPEN" | "CLOSED";
  anonymous: boolean;
  // 동점으로 마감했는지와 그때 고정한 표 수(AC-40)
  tie: boolean;
  tieVotes?: number;
  reopenable: boolean;
  // 모임장이 고른 순서
  candidates: { placeId: number; votes: number; voters?: number[] }[];
  votedCount: number;
  notVotedCount: number;
  notVoted?: number[];
  hasVoted?: boolean;
  myVote?: number;
};

export type DecisionMethod = "VOTE" | "PICK" | "DIRECT";

export type MeetupDecision = {
  placeId: number;
  method: DecisionMethod;
  // 동점에서 고른 경우의 동점 표 수
  tieVotes?: number;
};

export type PollOpenRequest = { placeIds: number[]; anonymous: boolean };

export type MeetupCalculation = {
  id: number;
  state: "RUNNING" | "SUCCEEDED" | "FAILED";
  startedAt: string;
  tasteCount: number;
  // 마지막 성공 뒤에 취향이나 모임 정보가 바뀌었거나 그 계산의 프로필이 지워졌는지(AC-18)
  outdated: boolean;
};

export type ProfileCreateRequest = { name: string; taste?: Taste };
export type ProfileCreateResponse = { profileId: number };

// 409의 problem.type(urn:fitdining:meetup:<종류>)
export type MeetupConflict =
  | "name-taken"
  | "full"
  | "already-joined"
  | "host-profile"
  | "calculating"
  | "poll-closed"
  | "no-votes"
  | "phase";

export const NAME_MAX = 10;
export const WANT_MENU_MAX = 20;
export const PRICE_CAP_MIN = 5_000;
export const PRICE_CAP_MAX = 100_000;
export const PRICE_CAP_STEP = 1_000;
// 투표 후보 수(AC-36)
export const POLL_CANDIDATES_MIN = 2;
export const POLL_CANDIDATES_MAX = 5;

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

export const RADII: MeetupRadius[] = [500, 1000, 2000, 5000];
// 지점의 위치 이름 글자 수(화면 예시 모임장 4)
export const POINT_NAME_MAX = 20;

export const HEADCOUNT_MIN = 2;
export const HEADCOUNT_MAX = 8;
export const DESCRIPTION_MAX = 100;

// 화면에 보이는 지역 이름. 역은 "역"을 붙이고, 지점은 위치 이름이다(없으면 빈 글)
export function areaLabel(area: { kind: AreaKind; name?: string }) {
  if (!area.name) return "";
  return area.kind === "STATION" ? `${area.name}역` : area.name;
}

// 반경 칩과 모임 정보의 반경 글("500m", "1km")
export function radiusLabel(meters: number) {
  return meters >= 1000 ? `${meters / 1000}km` : `${meters}m`;
}

// 모임 정보와 지역 칸의 지역 글. 지점은 반경을 붙인다("역삼동 근처 · 반경 1km")
export function areaText(area: {
  kind: AreaKind;
  name?: string;
  radiusM?: number;
}) {
  const label = areaLabel(area);
  if (area.kind !== "POINT" || area.radiusM === undefined) return label;
  const radius = `반경 ${radiusLabel(area.radiusM)}`;
  return label ? `${label} · ${radius}` : radius;
}

// 형식이 틀린 코드는 서버에 묻지 않고 없는 링크로 본다(D-2)
export function isMeetupCode(code: string) {
  return /^[A-Za-z0-9_-]{22}$/.test(code);
}

// 내 모임의 한 줄(AC-75). 만든 모임은 HOST, 회원 프로필로 참여한 모임은 PARTICIPANT다
export type MeetupListItem = {
  code: string;
  role: "HOST" | "PARTICIPANT";
  phase: MeetupPhase;
  area: MeetupInfo["area"];
  category: MeetupCategory;
  date?: string;
  time?: string;
  headcount?: number;
  profileCount: number;
  decidedPlaceName?: string;
};

export type MeetupList = { items: MeetupListItem[] };

export function meetupHref(code: string) {
  return `/m/${code}`;
}
