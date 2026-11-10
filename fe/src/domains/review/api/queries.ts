import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { isApiError } from "@/shared/api/api-error";

import type {
  ReviewCreateRequest,
  ReviewDetailResponse,
  ReviewReportRequest,
  ReviewUpdateRequest,
} from "../model/review";
import {
  createReview,
  deleteReview,
  fetchReview,
  fetchReviewForm,
  fetchReviews,
  reportReview,
  updateReview,
} from "./review-api";

// 로그인을 확인하고 요청을 보내는 함수를 실행한다. 리뷰 도메인은 인증 도메인을 부를 수 없어 app이 만들어 넘긴다
export type WithSession = <T>(send: () => Promise<T>) => Promise<T>;

// 로그인이 선택인 요청. 브라우저의 세션 쿠키로 개인화한다
export type WithOptionalSession = <T>(send: () => Promise<T>) => Promise<T>;

export const reviewKeys = {
  all: ["reviews"] as const,
  list: (placeId: number) => [...reviewKeys.all, "list", placeId] as const,
  form: (placeId: number) => [...reviewKeys.all, "form", placeId] as const,
  detail: (reviewId: number) =>
    [...reviewKeys.all, "detail", reviewId] as const,
};

// 커서로 이어 받는 장소별 리뷰 목록. 리뷰 탭과 홈 미리보기가 같은 캐시를 쓰므로 늘 같은 방식으로 받는다
export function useReviewList(
  placeId: number,
  withOptionalSession: WithOptionalSession,
) {
  return useInfiniteQuery({
    queryKey: reviewKeys.list(placeId),
    queryFn: ({ pageParam, signal }) =>
      withOptionalSession(() => fetchReviews(placeId, pageParam, signal)),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

// 작성 화면 데이터. 실패하면 화면의 "다시 시도"로만 다시 받는다
export function useReviewForm(placeId: number, authenticated: WithSession) {
  return useQuery({
    queryKey: reviewKeys.form(placeId),
    queryFn: ({ signal }) =>
      authenticated(() => fetchReviewForm(placeId, signal)),
    retry: false,
  });
}

// 등록에 성공하면 목록과 작성 화면 데이터(이미 쓴 날짜)를 낡은 것으로 표시한다(PRD AC-11).
// 등록은 같은 리뷰가 두 번 쌓이지 않도록 재시도하지 않는다(TanStack 기본값).
// 쓰기 요청은 오프라인이면 기다리지 않고 바로 실패한다. 기다리면 버튼이 진행 중으로 멈추고,
// 사용자가 나간 뒤에도 연결이 돌아오면 요청이 나간다(D-44)
export function useCreateReview(placeId: number, authenticated: WithSession) {
  const queryClient = useQueryClient();
  return useMutation({
    networkMode: "always",
    mutationFn: (body: ReviewCreateRequest) =>
      authenticated(() => createReview(placeId, body)),
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: reviewKeys.list(placeId) }),
        queryClient.invalidateQueries({ queryKey: reviewKeys.form(placeId) }),
      ]),
  });
}

// 수정 화면 데이터. 창으로 돌아오거나 다시 연결돼도 다시 받지 않는다.
// 수정 화면은 다시 받는 동안 입력칸을 내리고 새 본문으로 시작하므로, 쓰는 도중 입력이 사라지지 않게 한다.
// 오프라인이면 기다리지 않고 바로 실패해 "다시 시도"를 보인다
export function useReviewDetail(reviewId: number, authenticated: WithSession) {
  return useQuery({
    queryKey: reviewKeys.detail(reviewId),
    queryFn: ({ signal }) => authenticated(() => fetchReview(reviewId, signal)),
    retry: false,
    networkMode: "always",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

// 수정에 성공하면 목록을 낡은 것으로 표시한다(PRD AC-11). 이 리뷰는 다시 받지 않고 고친 본문으로 바꿔 둔다.
// 다시 받으면 수정 화면이 나가기 전에 입력칸을 내린다. 다음에 열 때는 다시 받는다.
// 사진은 새 주소를 몰라 바꿔 둘 수 없으므로 낡은 것으로만 표시하고 지금은 다시 받지 않는다
export function useUpdateReview(
  review: Pick<ReviewDetailResponse, "reviewId" | "placeId">,
  authenticated: WithSession,
) {
  const queryClient = useQueryClient();
  return useMutation({
    networkMode: "always",
    mutationFn: (body: ReviewUpdateRequest) =>
      authenticated(() => updateReview(review.reviewId, body)),
    onSuccess: (_, { description, photos }) => {
      if (description !== undefined) {
        queryClient.setQueryData<ReviewDetailResponse>(
          reviewKeys.detail(review.reviewId),
          (saved) =>
            saved && {
              ...saved,
              description: description.trim() === "" ? undefined : description,
            },
        );
      }
      if (photos !== undefined) {
        void queryClient.invalidateQueries({
          queryKey: reviewKeys.detail(review.reviewId),
          refetchType: "none",
        });
      }
      return queryClient.invalidateQueries({
        queryKey: reviewKeys.list(review.placeId),
      });
    },
    // 다른 창에서 이미 지운 리뷰(404)면 목록에서도 빼도록 다시 받는다
    onError: (error) =>
      isApiError(error) && error.status === 404
        ? queryClient.invalidateQueries({
            queryKey: reviewKeys.list(review.placeId),
          })
        : undefined,
  });
}

// 삭제에 성공하면 목록과 작성 화면 데이터(그날 다시 쓸 수 있다)를 낡은 것으로 표시한다(D-28).
// 이미 지운 리뷰(404)거나 응답만 늦은(시간 초과) 경우에도 목록을 다시 받아, 지워진 리뷰가 남지 않게 한다
export function useDeleteReview(placeId: number, authenticated: WithSession) {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: reviewKeys.list(placeId) }),
      queryClient.invalidateQueries({ queryKey: reviewKeys.form(placeId) }),
    ]);
  return useMutation({
    networkMode: "always",
    mutationFn: (reviewId: number) =>
      authenticated(() => deleteReview(reviewId)),
    onSuccess: refresh,
    onError: (error) =>
      isApiError(error) && (error.status === 404 || error.kind === "timeout")
        ? refresh()
        : undefined,
  });
}

// 신고만으로는 리뷰가 숨지 않아 목록을 다시 받지 않는다(D-11). 그사이 지워진 리뷰(404)면 목록에서 빼도록 다시 받는다
export function useReportReview(placeId: number, authenticated: WithSession) {
  const queryClient = useQueryClient();
  return useMutation({
    networkMode: "always",
    mutationFn: ({
      reviewId,
      body,
    }: {
      reviewId: number;
      body: ReviewReportRequest;
    }) => authenticated(() => reportReview(reviewId, body)),
    onError: (error) =>
      isApiError(error) && error.status === 404
        ? queryClient.invalidateQueries({ queryKey: reviewKeys.list(placeId) })
        : undefined,
  });
}
