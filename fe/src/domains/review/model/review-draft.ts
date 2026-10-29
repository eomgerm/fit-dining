import type { ReviewCreateRequest, ReviewFormResponse } from "./review";
import { hasGoodTag } from "./review-tags";
import { dayState } from "./visit-calendar";

// 작성 중인 입력. 세 페이지(7-01, 7-02, 7-04)가 함께 쓰고 등록할 때 한 번에 보낸다(D-41)
export type ReviewDraft = {
  // 오늘 이미 썼거나 다시 받은 범위 밖이면 고를 때까지 비어 있다
  visitedAt: string | null;
  tagCodes: string[];
  revisitIntent: boolean;
  description: string;
  // 숫자만 담은 문자열. 비면 금액 없음
  spentPerPerson: string;
};

export function initialDraft(form: ReviewFormResponse): ReviewDraft {
  return reconcileDraft(
    {
      visitedAt: form.visitDate.default,
      tagCodes: [],
      revisitIntent: false,
      description: "",
      spentPerPerson: "",
    },
    form,
  );
}

// 작성 화면 데이터에 맞춰 고를 수 없는 방문일(범위 밖, 이미 쓴 날)과 노출되지 않는 태그를 뺀다(D-41)
export function reconcileDraft(
  draft: ReviewDraft,
  form: ReviewFormResponse,
): ReviewDraft {
  const codes = new Set(
    [...form.tags.good, ...form.tags.bad].map((tag) => tag.code),
  );
  return {
    ...draft,
    visitedAt:
      draft.visitedAt !== null &&
      dayState(draft.visitedAt, form.visitDate, form.reviewedDates) ===
        "available"
        ? draft.visitedAt
        : null,
    tagCodes: draft.tagCodes.filter((code) => codes.has(code)),
  };
}

// 7-01의 X를 누를 때 7-E03을 띄울지 정한다
export function isDirty(draft: ReviewDraft, initial: ReviewDraft) {
  return (
    draft.visitedAt !== initial.visitedAt ||
    draft.tagCodes.length > 0 ||
    hasDetail(draft)
  );
}

// 2/2단계 입력이 하나라도 있으면 "등록하기", 없으면 "건너뛰고 등록하기"(7-04, 7-05)
export function hasDetail(draft: ReviewDraft) {
  return (
    draft.revisitIntent ||
    draft.description.trim() !== "" ||
    draft.spentPerPerson !== ""
  );
}

export function canLeaveGoodPage(draft: ReviewDraft, form: ReviewFormResponse) {
  return draft.visitedAt !== null && hasGoodTag(draft.tagCodes, form.tags.good);
}

// 숫자만 남기고 앞의 0을 지운다. 상한을 넘으면 null을 돌려 입력을 받지 않는다
export function normalizeSpent(raw: string, max: number) {
  const digits = raw.replace(/\D/g, "").replace(/^0+(?=\d)/, "");
  if (digits !== "" && Number(digits) > max) return null;
  return digits;
}

export function formatSpent(digits: string) {
  return digits === "" ? "" : Number(digits).toLocaleString("ko-KR");
}

// 공백뿐인 본문은 보내지 않는다. BE도 본문 없음으로 저장한다(D-6). 사진은 다 올린 것의 id만 담는다(D-45)
export function toCreateRequest(
  draft: ReviewDraft & { visitedAt: string },
  photoIds: readonly string[] = [],
): ReviewCreateRequest {
  return {
    visitedAt: draft.visitedAt,
    tagCodes: draft.tagCodes,
    revisitIntent: draft.revisitIntent,
    ...(draft.description.trim() !== "" && { description: draft.description }),
    ...(draft.spentPerPerson !== "" && {
      spentPerPerson: Number(draft.spentPerPerson),
    }),
    ...(photoIds.length > 0 && { photos: [...photoIds] }),
  };
}
