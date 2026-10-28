"use client";

import { useEffect, useState } from "react";

import { cn } from "@/shared/lib/cn";

import { useReviewList, type WithOptionalAccessToken } from "../api/queries";
import { PREVIEW_SIZE } from "../model/review";
import { ReviewListView } from "./review-list-view";

type ReviewSectionProps = {
  placeId: number;
  // 있으면 홈 탭 미리보기(Figma 6-01)다. 최신 3건만 보이고, 머리글 "리뷰 N >"가 이 함수를 부른다.
  // 장소 상세가 리뷰 탭으로 바꾸는 함수를 넘긴다. 없으면 리뷰 탭 전체 목록(6-03)이다
  onShowAll?: () => void;
  // 로그인했으면 AT를 붙여 내 리뷰에 "내 리뷰" 태그가 붙게 받는다. 리뷰 도메인은 인증 도메인을 부를 수 없어 app이 넘긴다
  withOptionalAccessToken: WithOptionalAccessToken;
  // 폭·바깥 여백 같은 배치용 클래스
  className?: string;
};

// 장소 상세의 리뷰 섹션. 장소 상세는 리뷰 탭과 홈 탭에 넣기만 한다.
//   리뷰 탭: <ReviewSection placeId={id} />          목록 끝이 보이면 다음 페이지를 받는다
//   홈 탭:   <ReviewSection placeId={id} onShowAll={() => 리뷰 탭으로} />
// 두 자리가 같은 쿼리를 써서 탭을 오가도 목록을 다시 받지 않는다.
// "방문 평가 남기기"는 장소 상세의 하단 막대가 reviewWriteHref로 연결한다(D-32)
export function ReviewSection({
  placeId,
  onShowAll,
  withOptionalAccessToken,
  className,
}: ReviewSectionProps) {
  const {
    data,
    status,
    hasNextPage,
    isFetchingNextPage,
    isFetchNextPageError,
    fetchNextPage,
    refetch,
  } = useReviewList(placeId, withOptionalAccessToken);
  const endRef = useOnVisible(() => fetchNextPage());
  const pages = data?.pages ?? [];
  const isPreview = onShowAll !== undefined;
  const items = isPreview
    ? (pages[0]?.items.slice(0, PREVIEW_SIZE) ?? [])
    : pages.flatMap((page) => page.items);

  return (
    <ReviewListView
      // 다음 페이지만 실패하면 받은 목록은 그대로 두고 그 자리에서 다시 받는다
      status={data ? "success" : status}
      // 리뷰 수는 첫 페이지 응답에만 있다
      totalCount={pages[0]?.totalCount}
      items={items}
      onShowAll={onShowAll}
      skeletonRows={isPreview ? PREVIEW_SIZE : 5}
      onRetry={() => refetch()}
      {...(!isPreview && {
        hasNextPage,
        isFetchingNextPage,
        isFetchNextPageError,
        onRetryNextPage: () => fetchNextPage(),
        endRef,
      })}
      // 장소 상세의 여백을 따른다: 리뷰 탭은 메뉴·정보 탭처럼 px-4 py-6,
      // 홈 미리보기는 홈 탭이 다른 섹션과 함께 감싸므로 바깥 여백이 없다(D-32)
      className={cn(!isPreview && "px-4 py-6", className)}
    />
  );
}

// 요소가 화면 아래 200px 안으로 들어오면 부른다. 요소가 바뀌거나 사라지면 관찰을 멈춘다
function useOnVisible(onVisible: () => void) {
  const [node, setNode] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) onVisible();
      },
      { rootMargin: "0px 0px 200px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [node, onVisible]);
  return setNode;
}
