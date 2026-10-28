import { isNearby, type DevicePosition } from "./nearby-check";
import type { ReviewFormResponse } from "./review";

// 장소 상세에서 "방문 평가 남기기"를 눌렀을 때 확인한 결과를 작성 화면에 넘긴다(D-43)
export type VisitEntry = {
  // 7-01에 "방문 확인 완료"를 보인다
  verified: boolean;
  // 7-E01의 "다른 날 고르기"로 들어와 방문일 시트(7-03)를 연다
  pickDate: boolean;
};

export type EntryCheck = "reviewedToday" | "nearby" | "notNearby";

// 오늘은 작성 화면 데이터의 방문일 상한(BE의 KST 오늘)이다
export function reviewedToday(form: ReviewFormResponse) {
  return form.reviewedDates.includes(form.visitDate.max);
}

// 오늘 이미 쓴 장소면 위치와 상관없이 7-E01이다. 위치를 받지 못했으면(권한 거절, 시간 초과) 근처가 아니다
export function entryCheck(
  form: ReviewFormResponse,
  position: DevicePosition | null,
): EntryCheck {
  if (reviewedToday(form)) return "reviewedToday";
  return position && isNearby(form.place, position) ? "nearby" : "notNearby";
}
