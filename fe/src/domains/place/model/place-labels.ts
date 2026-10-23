import type {
  CategoryGroup,
  EvidenceSource,
  Facility,
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

export const FACILITY_LABELS: Record<Facility, string> = {
  PARKING: "주차",
  WIFI: "무선 인터넷",
  GROUP: "단체 이용",
  RESERVATION: "예약",
};

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
