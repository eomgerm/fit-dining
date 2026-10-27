import { request } from "@/shared/api/client";

import type {
  ReviewCreateRequest,
  ReviewCreateResponse,
  ReviewFormResponse,
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

// 작성 화면 데이터. 이 사용자가 이미 쓴 방문일이 들어 있어 로그인이 필요하다(D-37)
export function fetchReviewForm(
  placeId: number,
  accessToken: string,
  signal?: AbortSignal,
) {
  return request<ReviewFormResponse>(`/v1/places/${placeId}/review-form`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  });
}

// 로그인한 사용자만 등록한다. AT는 부르는 쪽이 넘긴다(D-15)
export function createReview(
  placeId: number,
  body: ReviewCreateRequest,
  accessToken: string,
) {
  return request<ReviewCreateResponse>(`/v1/places/${placeId}/reviews`, {
    method: "POST",
    body,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}
