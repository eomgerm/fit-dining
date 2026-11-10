import { CATEGORY_LABELS } from "./place-labels";
import type { CategoryGroup, OpenStatus, PlaceSummary } from "./place-types";

// GET /api/v1/me/bookmarks 응답의 항목(bookmark D-13). 핏 점수와 추천 이유는 없다
export type BookmarkItem = {
  place: PlaceSummary;
  address?: string;
  tags: string[];
  openStatus: OpenStatus;
  // +09:00 오프셋 ISO-8601
  savedAt: string;
};

// 화면이 아는 로그인 상태. checking은 페이지를 열 때 로그인을 복원하는 중이다(3초까지)
export type BookmarkSession =
  | { status: "checking" }
  | { status: "guest" }
  | { status: "user"; userId: string };

// 북마크에 필요한 인증. place 도메인은 auth 도메인을 import하지 않으므로 app이 채워 넘긴다(D-5)
export type BookmarkAccess = {
  session: BookmarkSession;
  // 지금 앱의 로그인 사용자. 늦게 끝난 요청의 결과를 버릴지 정할 때 본다
  currentUserId: () => string | undefined;
  // userId 계정의 AT로만 보낸다. 보내는 순간 계정이 다르거나 로그인 정보가 없으면
  // BookmarkAccountChanged로 끝난다. 만료된 AT는 한 번 갱신해 다시 보낸다
  send: <T>(userId: string, request: () => Promise<T>) => Promise<T>;
  // RT 갱신을 거쳐도 401이면 세션이 끝난 것으로 보고 앱의 로그인 정보를 지운다(D-7)
  endSession: () => void;
  // 로그인 화면으로 간다. 로그인한 뒤 returnTo로 돌아온다(D-8)
  login: (returnTo: string) => void;
};

// 보내기 전에 계정이 바뀌어 요청을 보내지 않았다(AC-15). 화면은 결과를 버린다
export class BookmarkAccountChanged extends Error {
  constructor() {
    super("로그인한 계정이 바뀌어 요청을 보내지 않았습니다");
    this.name = "BookmarkAccountChanged";
  }
}

export const SAVED_VIEW = "saved";

// 저장한 장소 화면 주소. 업종 탭을 고르지 않았으면 category가 없다
export function savedPlacesHref(category?: CategoryGroup) {
  return category
    ? `/?view=${SAVED_VIEW}&category=${category}`
    : `/?view=${SAVED_VIEW}`;
}

// 주소의 category. 모르는 값이면 전체 탭이다
export function parseCategory(raw: string | null): CategoryGroup | undefined {
  return raw && Object.hasOwn(CATEGORY_LABELS, raw)
    ? (raw as CategoryGroup)
    : undefined;
}

// 업종 탭 순서. 이름표에 업종을 더하면 탭도 는다(D-13)
export const CATEGORY_TABS = Object.keys(CATEGORY_LABELS) as CategoryGroup[];

// 받침이 있으면 "이", 없으면 "가". "저장한 식당이 없어요", "저장한 카페가 없어요"
export function emptyCategoryText(category: CategoryGroup) {
  const label = CATEGORY_LABELS[category];
  const last = label.charCodeAt(label.length - 1) - 0xac00;
  const hasFinal = last >= 0 && last < 11172 && last % 28 !== 0;
  return `저장한 ${label}${hasFinal ? "이" : "가"} 없어요`;
}

// 장소 상세 주소. 저장한 장소 화면에서 열면 from=saved가 붙어 핏 점수와 추천 이유를 숨긴다(D-12)
export function placeDetailHref(placeId: number, fromSaved = false) {
  return `/places/${placeId}${fromSaved ? `?from=${SAVED_VIEW}` : ""}`;
}
