// 리뷰 API의 요청·응답 모양(spec Interfaces). 1차 후속에서 필드가 더해진다

export type ReviewItem = {
  reviewId: number;
  // Asia/Seoul 오프셋이 붙은 작성 시각(예: 2026-10-20T15:00:00+09:00)
  createdAt: string;
  // 본문 없이 남긴 리뷰면 없다
  description?: string;
};

export type ReviewListResponse = {
  totalCount: number;
  items: ReviewItem[];
  // 다음 페이지가 있을 때만 있다
  nextCursor?: string;
};

export type ReviewCreateRequest = {
  description?: string;
};

export type ReviewCreateResponse = {
  reviewId: number;
};

// 본문 최대 길이. 공통 Textarea와 BE @Size처럼 UTF-16 단위로 센다(D-30)
export const DESCRIPTION_MAX = 500;

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

// 공백뿐이면 본문 없이 보낸다. BE도 본문 없음으로 저장한다(D-6)
export function toCreateRequest(text: string): ReviewCreateRequest {
  return text.trim() === "" ? {} : { description: text };
}

// 주소의 id는 BE와 같이 양의 정수만 받는다(AC-2). 아니면 null
export function parsePlaceId(value: string | null) {
  if (value === null || !/^[1-9][0-9]*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : null;
}
