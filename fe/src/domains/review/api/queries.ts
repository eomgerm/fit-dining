import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";

import type { ReviewCreateRequest } from "../model/review";
import { createReview, fetchReviews } from "./review-api";

// AT를 받아 요청을 보내는 함수를 실행한다. 리뷰 도메인은 인증 도메인을 부를 수 없어 app이 만들어 넘긴다
export type WithAccessToken = <T>(
  send: (accessToken: string) => Promise<T>,
) => Promise<T>;

export const reviewKeys = {
  all: ["reviews"] as const,
  list: (placeId: number) => [...reviewKeys.all, "list", placeId] as const,
};

// 커서로 이어 받는 장소별 리뷰 목록
export function useReviewList(placeId: number) {
  return useInfiniteQuery({
    queryKey: reviewKeys.list(placeId),
    queryFn: ({ pageParam, signal }) =>
      fetchReviews(placeId, pageParam, signal),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });
}

// 등록에 성공하면 목록을 낡은 것으로 표시해, 리뷰 탭이 다시 보일 때 새로 받게 한다(PRD AC-11).
// 등록은 같은 리뷰가 두 번 쌓이지 않도록 재시도하지 않는다(TanStack 기본값)
export function useCreateReview(
  placeId: number,
  withAccessToken: WithAccessToken,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: ReviewCreateRequest) =>
      withAccessToken((accessToken) =>
        createReview(placeId, body, accessToken),
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: reviewKeys.list(placeId) }),
  });
}
