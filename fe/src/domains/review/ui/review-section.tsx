"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button/button";
import { TrashIcon } from "@/shared/ui/icon/icons/trash";
import { ConfirmDialog } from "@/shared/ui/overlay/confirm-dialog";
import { useToast } from "@/shared/ui/overlay/toast";

import {
  useDeleteReview,
  useReviewList,
  type WithAccessToken,
  type WithOptionalAccessToken,
} from "../api/queries";
import { PREVIEW_SIZE } from "../model/review";
import { deleteFailureMessage } from "./edit-failure";
import { ReviewListView } from "./review-list-view";

type ReviewSectionProps = {
  placeId: number;
  // 있으면 홈 탭 미리보기(Figma 6-01)다. 최신 3건만 보이고, 머리글 "리뷰 N >"가 이 함수를 부른다.
  // 장소 상세가 리뷰 탭으로 바꾸는 함수를 넘긴다. 없으면 리뷰 탭 전체 목록(6-03)이다
  onShowAll?: () => void;
  // 로그인했으면 AT를 붙여 내 리뷰에 "내 리뷰" 태그가 붙게 받는다. 리뷰 도메인은 인증 도메인을 부를 수 없어 app이 넘긴다
  withOptionalAccessToken: WithOptionalAccessToken;
  // 내 리뷰 삭제 요청에 AT를 붙인다
  withAccessToken: WithAccessToken;
  // 내 리뷰 ⋯ 메뉴의 "수정하기". 화면 이동은 app이 정한다(D-44)
  onEdit: (reviewId: number) => void;
  // 폭·바깥 여백 같은 배치용 클래스
  className?: string;
};

// 장소 상세의 리뷰 섹션. 장소 상세는 리뷰 탭과 홈 탭에 넣기만 한다.
//   리뷰 탭: <ReviewSection placeId={id} />          목록 끝이 보이면 다음 페이지를 받는다
//   홈 탭:   <ReviewSection placeId={id} onShowAll={() => 리뷰 탭으로} />
// 두 자리가 같은 쿼리를 써서 탭을 오가도 목록을 다시 받지 않는다.
// "방문 평가 남기기"는 장소 상세의 하단 막대가 reviewWriteHref로 연결한다(D-32).
// 내 리뷰의 "삭제하기"는 확인(6-08)을 받아 지우고, 목록을 다시 받은 뒤 토스트(6-09)를 띄운다(D-44)
export function ReviewSection({
  placeId,
  onShowAll,
  withOptionalAccessToken,
  withAccessToken,
  onEdit,
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
  const [deleting, setDeleting] = useState<number | null>(null);
  // "삭제"를 눌렀으면 창이 닫힐 때 리뷰 섹션으로 포커스를 보낸다. 지운 리뷰의 ⋯ 버튼은 목록에서 빠진다
  const [confirmed, setConfirmed] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);
  const deleteReview = useDeleteReview(placeId, withAccessToken);
  const toast = useToast();
  const pages = data?.pages ?? [];
  const isPreview = onShowAll !== undefined;
  const items = isPreview
    ? (pages[0]?.items.slice(0, PREVIEW_SIZE) ?? [])
    : pages.flatMap((page) => page.items);

  function openDelete(reviewId: number) {
    setConfirmed(false);
    setDeleting(reviewId);
  }

  function confirmDelete() {
    if (deleting === null || deleteReview.isPending) return;
    setConfirmed(true);
    // 지우는 동안 창을 닫지 않고, 목록을 다시 받은 뒤 닫는다
    deleteReview.mutate(deleting, {
      onSuccess: () => toast("리뷰를 삭제했어요"),
      onError: (error) => toast(deleteFailureMessage(error)),
      onSettled: () => setDeleting(null),
    });
  }

  return (
    <>
      <ReviewListView
        // 다음 페이지만 실패하면 받은 목록은 그대로 두고 그 자리에서 다시 받는다
        status={data ? "success" : status}
        // 리뷰 수는 첫 페이지 응답에만 있다
        totalCount={pages[0]?.totalCount}
        items={items}
        onShowAll={onShowAll}
        onEdit={onEdit}
        onDelete={openDelete}
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
        ref={sectionRef}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open && !deleteReview.isPending) setDeleting(null);
        }}
        finalFocus={confirmed ? sectionRef : undefined}
        tone="danger"
        icon={<TrashIcon />}
        title="리뷰를 삭제할까요?"
        description={
          <>
            삭제한 리뷰는 복구할 수 없어요.
            <br />
            정말 삭제하시겠어요?
            {/* 창 밖은 가려져 있어 창 안에서 알린다 */}
            <span role="status" className="sr-only">
              {deleteReview.isPending ? "리뷰를 삭제하고 있어요" : ""}
            </span>
          </>
        }
        secondaryAction={
          <Button
            variant="outline"
            size="md"
            disabled={deleteReview.isPending}
            focusableWhenDisabled
            onClick={() => setDeleting(null)}
          >
            취소
          </Button>
        }
        action={
          <Button
            variant="danger"
            size="md"
            disabled={deleteReview.isPending}
            focusableWhenDisabled
            aria-busy={deleteReview.isPending}
            onClick={confirmDelete}
          >
            {deleteReview.isPending ? "삭제하는 중" : "삭제"}
          </Button>
        }
      />
    </>
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
