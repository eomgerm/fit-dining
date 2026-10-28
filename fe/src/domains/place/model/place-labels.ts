import type {
  CategoryGroup,
  EvidenceSource,
  OpenStatus,
  ScoreItem,
} from "./place-types";

// 화면에 보이는 한글 이름. 순서는 동점일 때의 우선순위이기도 하다(식당, 카페, 술집)
export const CATEGORY_LABELS: Record<CategoryGroup, string> = {
  RESTAURANT: "식당",
  CAFE: "카페",
  BAR: "술집",
};

// UNKNOWN은 화면에 표시하지 않는다
export const OPEN_STATUS_LABELS: Record<OpenStatus, string | undefined> = {
  OPEN: "영업 중",
  CLOSING_SOON: "곧 마감",
  BREAK: "브레이크타임",
  CLOSED: "영업 종료",
  UNKNOWN: undefined,
};

// 시설 칩 아이콘의 묶음. 비슷한 시설은 같은 아이콘을 쓴다
export type FacilityIconGroup =
  | "parking"
  | "wifi"
  | "group"
  | "reservation"
  | "takeout"
  | "restroom"
  | "kids"
  | "wheelchair"
  | "pet"
  | "menu";

// 네이버 시설 이름 → 아이콘 묶음. 여기에 없는 이름은 기본 아이콘이다
export const FACILITY_ICON_GROUPS: Record<string, FacilityIconGroup> = {
  주차: "parking",
  발렛파킹: "parking",
  "장애인 주차구역": "parking",
  "무선 인터넷": "wifi",
  "단체 이용 가능": "group",
  예약: "reservation",
  포장: "takeout",
  배달: "takeout",
  "테이크아웃 할인": "takeout",
  "남/녀 화장실 구분": "restroom",
  유아의자: "kids",
  키즈메뉴: "kids",
  노키즈존: "kids",
  "출입구 휠체어 이용가능": "wheelchair",
  "좌석 휠체어 이용가능": "wheelchair",
  "화장실 휠체어 이용가능": "wheelchair",
  "반려동물 동반": "pet",
  "비건 메뉴": "menu",
  "글루텐프리 메뉴": "menu",
  "유기농 메뉴": "menu",
  "무한 리필": "menu",
  "와인 페어링": "menu",
};

export function facilityIconGroup(name: string): FacilityIconGroup | undefined {
  return Object.hasOwn(FACILITY_ICON_GROUPS, name)
    ? FACILITY_ICON_GROUPS[name]
    : undefined;
}

export const EVIDENCE_LABELS: Record<EvidenceSource, string> = {
  REQUEST: "요청",
  PREFERENCE: "내 취향",
};

// "요청 · 조용해요"
export function evidenceText(source: EvidenceSource, label: string) {
  return `${EVIDENCE_LABELS[source]} · ${label}`;
}

// 홈 탭 추천 이유 아래의 근거 부족 안내. 점수에 넣지 못한(matched가 아닌) 항목마다 하나다
export function missingEvidenceNotes(items: ScoreItem[]) {
  return items
    .filter(({ matched }) => !matched)
    .map(
      ({ source, label }) =>
        `이 장소는 ‘${label}’ ${source === "PREFERENCE" ? "취향을" : "요청을"} 확인할 근거가 부족해요`,
    );
}
