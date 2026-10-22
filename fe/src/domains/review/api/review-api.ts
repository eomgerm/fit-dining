import { request } from "@/shared/api/client";

import type {
  ReviewCreateRequest,
  ReviewCreateResponse,
  ReviewListResponse,
} from "../model/review";

// 장소의 리뷰를 최신순으로 20건씩 받는다. cursor는 직전 응답의 nextCursor다
export function fetchReviews(
  placeId: number,
  cursor?: string,
  signal?: AbortSignal,
) {
  return request<ReviewListResponse>(`/v1/places/${placeId}/reviews`, {
    query: { cursor },
    signal,
  });
}

// Walking Skeleton은 로그인 없이 등록한다(D-15)
export function createReview(placeId: number, body: ReviewCreateRequest) {
  return request<ReviewCreateResponse>(`/v1/places/${placeId}/reviews`, {
    method: "POST",
    body,
  });
}
