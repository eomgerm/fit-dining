// 리뷰 API의 요청·응답 모양(spec Interfaces)

export type ReviewItem = {
  reviewId: number;
  // Asia/Seoul 오프셋이 붙은 작성 시각(예: 2026-10-20T15:00:00+09:00)
  createdAt: string;
  // 본문 없이 남긴 리뷰면 없다
  description?: string;
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

// 홈 탭 미리보기에 보이는 리뷰 수(Figma 6-01)
export const PREVIEW_SIZE = 3;

// 작성 화면 주소. 장소 상세의 "방문 평가 남기기"가 이 주소로 연결한다(D-31)
export function reviewWriteHref(placeId: number) {
  return `/place/review?id=${placeId}`;
}

const kstMonthDay = new Intl.DateTimeFormat("ko-KR", {
  timeZone: "Asia/Seoul",
  month: "long",
  day: "numeric",
});

// 목록 날짜(AC-7). Figma의 "10월 12일 방문" 꼴을 따라 "10월 20일"이다
export function formatKstDate(createdAt: string) {
  return kstMonthDay.format(new Date(createdAt));
}

// 주소의 id는 BE와 같이 양의 정수만 받는다(AC-2). 아니면 null
export function parsePlaceId(value: string | null) {
  if (value === null || !/^[1-9][0-9]*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}
