import { request } from "@/shared/api/client";

import type {
  ReviewCreateRequest,
  ReviewCreateResponse,
  ReviewDetailResponse,
  ReviewFormResponse,
  ReviewListResponse,
  ReviewReportRequest,
  ReviewUpdateRequest,
} from "../model/review";

// 장소의 리뷰를 최신순으로 20건씩 받는다. cursor는 직전 응답의 nextCursor다.
// 로그인은 선택이고, AT를 붙이면 내 리뷰에 mine이 붙는다(D-42)
export function fetchReviews(
  placeId: number,
  cursor?: string,
  signal?: AbortSignal,
  accessToken?: string,
) {
  return request<ReviewListResponse>(`/v1/places/${placeId}/reviews`, {
    query: { cursor },
    signal,
    headers: accessToken
      ? { Authorization: `Bearer ${accessToken}` }
      : undefined,
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

// 수정 화면 데이터. 본인 리뷰만 받는다(D-44)
export function fetchReview(
  reviewId: number,
  accessToken: string,
  signal?: AbortSignal,
) {
  return request<ReviewDetailResponse>(`/v1/reviews/${reviewId}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal,
  });
}

export function updateReview(
  reviewId: number,
  body: ReviewUpdateRequest,
  accessToken: string,
) {
  return request<void>(`/v1/reviews/${reviewId}`, {
    method: "PATCH",
    body,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

export function deleteReview(reviewId: number, accessToken: string) {
  return request<void>(`/v1/reviews/${reviewId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}

// 남의 리뷰 신고. 같은 리뷰는 한 번만 신고할 수 있다(D-11)
export function reportReview(
  reviewId: number,
  body: ReviewReportRequest,
  accessToken: string,
) {
  return request<void>(`/v1/reviews/${reviewId}/reports`, {
    method: "POST",
    body,
    headers: { Authorization: `Bearer ${accessToken}` },
  });
}
