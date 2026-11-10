import { ApiError } from "@/shared/api/api-error";
import { request } from "@/shared/api/client";

import type {
  PhotoUploadResponse,
  ReviewCreateRequest,
  ReviewCreateResponse,
  ReviewDetailResponse,
  ReviewFormResponse,
  ReviewListResponse,
  ReviewReportRequest,
  ReviewUpdateRequest,
} from "../model/review";

// 장소의 리뷰를 최신순으로 20건씩 받는다. cursor는 직전 응답의 nextCursor다.
// 로그인은 선택이고, 세션이 있으면 내 리뷰에 mine이 붙는다(D-42)
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
export function fetchReviewForm(placeId: number, signal?: AbortSignal) {
  return request<ReviewFormResponse>(`/v1/places/${placeId}/review-form`, {
    signal,
  });
}

// 로그인한 사용자만 등록한다. 인증은 세션 쿠키로 처리한다(D-15)
export function createReview(placeId: number, body: ReviewCreateRequest) {
  return request<ReviewCreateResponse>(`/v1/places/${placeId}/reviews`, {
    method: "POST",
    body,
  });
}

// 수정 화면 데이터. 본인 리뷰만 받는다(D-44)
export function fetchReview(reviewId: number, signal?: AbortSignal) {
  return request<ReviewDetailResponse>(`/v1/reviews/${reviewId}`, {
    signal,
  });
}

export function updateReview(reviewId: number, body: ReviewUpdateRequest) {
  return request<void>(`/v1/reviews/${reviewId}`, {
    method: "PATCH",
    body,
  });
}

export function deleteReview(reviewId: number) {
  return request<void>(`/v1/reviews/${reviewId}`, {
    method: "DELETE",
  });
}

// 사진 업로드 주소. 사진마다 1,600px 사진과 썸네일 주소를 준다(D-45)
export function fetchPhotoUploads(count: number, signal?: AbortSignal) {
  return request<PhotoUploadResponse>("/v1/review-photos/upload-urls", {
    method: "POST",
    body: { count },
    signal,
  });
}

const PHOTO_PUT_TIMEOUT_MS = 30_000;

// 받은 주소에 사진을 바로 올린다. 주소는 같은 출처 상대 경로이고 API(/api)가 아니라 공통 클라이언트를 쓰지 않는다.
// 서명에 Content-Type이 들어 있어 image/jpeg만 보낸다
// 사진을 빼거나 화면을 떠나면 signal로 멈춘다. 공통 클라이언트처럼 AbortSignal.any 없이 두 신호를 합친다
export async function putPhoto(url: string, body: Blob, signal?: AbortSignal) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, PHOTO_PUT_TIMEOUT_MS);
  if (signal?.aborted) controller.abort(signal.reason);
  signal?.addEventListener("abort", () => controller.abort(signal.reason), {
    once: true,
    signal: controller.signal,
  });
  let response: Response;
  try {
    response = await fetch(url, {
      method: "PUT",
      headers: { "Content-Type": "image/jpeg" },
      body,
      signal: controller.signal,
    });
  } catch {
    throw timedOut
      ? new ApiError("timeout", "사진을 올리는 시간이 초과되었습니다")
      : new ApiError("network", "사진을 올리지 못했습니다");
  } finally {
    clearTimeout(timer);
  }
  if (!response.ok) {
    throw new ApiError("http", "사진을 올리지 못했습니다", {
      status: response.status,
    });
  }
}

// 남의 리뷰 신고. 같은 리뷰는 한 번만 신고할 수 있다(D-11)
export function reportReview(reviewId: number, body: ReviewReportRequest) {
  return request<void>(`/v1/reviews/${reviewId}/reports`, {
    method: "POST",
    body,
  });
}
