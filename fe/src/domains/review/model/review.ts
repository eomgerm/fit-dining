// 리뷰 API의 요청·응답 모양(spec Interfaces)

export type TagView = {
  code: string;
  // 장소 업종의 문구
  label: string;
  sentiment: "GOOD" | "BAD";
};

export type ReviewItem = {
  reviewId: number;
  // Asia/Seoul 오프셋이 붙은 작성 시각(예: 2026-10-20T15:00:00+09:00). 화면은 방문일을 보인다
  createdAt: string;
  // KST 날짜(예: 2026-10-20)
  visitedAt: string;
  // 탈퇴한 회원이면 없다(D-38)
  nickname?: string;
  revisitIntent: boolean;
  // 좋았어요가 먼저다
  tags: TagView[];
  // 본문 없이 남긴 리뷰면 없다
  description?: string;
  // 로그인한 사용자 자신의 리뷰
  mine: boolean;
};

export type ReviewListResponse = {
  // 장소의 리뷰 수(삭제·숨김 제외). 첫 페이지에만 있다
  totalCount?: number;
  items: ReviewItem[];
  // 다음 페이지가 있을 때만 있다
  nextCursor?: string;
};

export type ReviewCreateRequest = {
  // KST 날짜(예: 2026-10-21)
  visitedAt: string;
  tagCodes: string[];
  revisitIntent: boolean;
  description?: string;
  spentPerPerson?: number;
};

export type ReviewCreateResponse = {
  reviewId: number;
};

export type FormTag = {
  code: string;
  label: string;
  // 같은 값의 태그는 함께 고를 수 없다(D-5)
  group: string;
  displayGroup: string;
};

// 작성 화면 데이터(D-37). 날짜는 모두 KST 날짜 문자열이다
export type ReviewFormResponse = {
  place: {
    name: string;
    categoryGroup: string;
    station: string;
    thumbnailUrl?: string;
    // 기기 위치와 견줘 방문을 확인하는 데만 쓴다(D-43)
    lat?: number;
    lng?: number;
  };
  visitDate: { min: string; max: string; default: string };
  reviewedDates: string[];
  tags: { good: FormTag[]; bad: FormTag[] };
  limits: {
    descriptionMax: number;
    photoMax: number;
    spentPerPersonMax: number;
  };
  writable: boolean;
};

// 수정 화면 데이터(D-44). 고칠 수 있는 필드만 담는다. 사진은 S15P31A302-54에서 더한다
export type ReviewDetailResponse = {
  reviewId: number;
  // 수정한 뒤 돌아갈 장소 상세와 다시 받을 목록의 장소
  placeId: number;
  // 본문 없이 남긴 리뷰면 없다
  description?: string;
  limits: { descriptionMax: number; photoMax: number };
};

// 작성자는 본문과 사진만 고친다(D-6). 빈 문자열이나 공백이면 본문 없음으로 저장된다
export type ReviewUpdateRequest = {
  description: string;
};

// 신고 사유(PRD FR-12, D-11). 설명은 "기타"일 때만 받는다
export type ReportReason = "AD_SPAM" | "ABUSE" | "UNRELATED" | "OTHER";

export const REPORT_REASONS: readonly { value: ReportReason; label: string }[] =
  [
    { value: "AD_SPAM", label: "광고·도배" },
    { value: "ABUSE", label: "욕설·혐오·음란물" },
    { value: "UNRELATED", label: "장소와 무관한 내용" },
    { value: "OTHER", label: "기타" },
  ];

export const REPORT_DETAIL_MAX = 100;

export type ReviewReportRequest = {
  reason: ReportReason;
  detail?: string;
};

// "기타"가 아니거나 설명이 공백뿐이면 설명을 보내지 않는다
export function reportRequest(
  reason: ReportReason,
  detail: string,
): ReviewReportRequest {
  return reason === "OTHER" && detail.trim() !== ""
    ? { reason, detail }
    : { reason };
}

// 홈 탭 미리보기에 보이는 리뷰 수(Figma 6-01)
export const PREVIEW_SIZE = 3;

// 작성 화면 주소. 장소 상세의 "방문 평가 남기기"가 이 주소로 연결한다(D-31)
export function reviewWriteHref(placeId: number) {
  return `/place/review?id=${placeId}`;
}

// 수정 화면 주소. 내 리뷰 ⋯ 메뉴의 "수정하기"가 연다(D-44).
// id는 장소 상세·작성 화면처럼 장소 id다. Next가 숨겨 둔 장소 상세도 지금 주소의 id를 읽어,
// 다른 값이면 다른 장소를 불러오고 보던 탭을 잃는다
export function reviewEditHref(placeId: number, reviewId: number) {
  return `/place/review/edit?id=${placeId}&review=${reviewId}`;
}

// 공백뿐인 본문은 본문 없음으로 저장되므로(D-6) 그 둘은 바뀐 것으로 보지 않는다
export function isDescriptionChanged(saved: string | undefined, draft: string) {
  return (draft.trim() === "" ? undefined : draft) !== saved;
}

// 목록 날짜(6-03). "2026-10-12" → "10월 12일 방문"
export function formatVisitedDay(visitedAt: string) {
  const [, month, day] = visitedAt.split("-").map(Number);
  return `${month}월 ${day}일 방문`;
}

// 목록의 작성자 자리. 탈퇴한 회원이면 닉네임이 없다(D-38)
export function authorLabel(item: Pick<ReviewItem, "nickname">) {
  return item.nickname ?? "탈퇴한 회원";
}

// 주소의 id는 BE와 같이 양의 정수만 받는다(AC-2). 아니면 null
export function parsePlaceId(value: string | null) {
  return parsePositiveId(value);
}

export function parseReviewId(value: string | null) {
  return parsePositiveId(value);
}

function parsePositiveId(value: string | null) {
  if (value === null || !/^[1-9][0-9]*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}
