import type { Ref } from "react";

import { Button } from "@/shared/ui/button/button";
import { TextButton } from "@/shared/ui/button/text-button";
import { EmptyState } from "@/shared/ui/display/empty-state";
import { ChatIcon } from "@/shared/ui/icon/icons/chat";
import { WifiOffIcon } from "@/shared/ui/icon/icons/wifi-off";
import {
  SectionHeader,
  SectionHeaderAction,
} from "@/shared/ui/layout/section-header";
import { cn } from "@/shared/lib/cn";

import { formatKstDate, type ReviewItem } from "../model/review";

export type ReviewListViewProps = {
  status: "pending" | "error" | "success";
  // 불러온 뒤에만 있다
  totalCount?: number;
  items: ReviewItem[];
  // 있으면 머리글 오른쪽에 "전체 보기"를 둔다(홈 탭 미리보기). 리뷰가 없으면 숨긴다
  onShowAll?: () => void;
  // 처음 불러오는 중에 보일 자리 표시 줄 수
  skeletonRows?: number;
  onRetry: () => void;
  // 리뷰 탭에서만: 다음 페이지 상태와 목록 끝 표시
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  isFetchNextPageError?: boolean;
  onRetryNextPage?: () => void;
  // 목록 끝에 두는 빈 요소. 보이면 다음 페이지를 받는다
  endRef?: Ref<HTMLDivElement>;
  className?: string;
};

// 리뷰 탭(6-03)과 홈 탭 미리보기(6-01)가 함께 쓰는 목록 화면.
// 데이터 훅과 나눠 상태별 모양을 정적으로 확인한다(D-31, D-32)
export function ReviewListView({
  status,
  totalCount,
  items,
  onShowAll,
  skeletonRows = 3,
  onRetry,
  hasNextPage = false,
  isFetchingNextPage = false,
  isFetchNextPageError = false,
  onRetryNextPage,
  endRef,
  className,
}: ReviewListViewProps) {
  return (
    <section aria-label="리뷰" className={cn("flex flex-col", className)}>
      <SectionHeader
        title="리뷰"
        count={status === "success" ? totalCount : undefined}
        action={
          onShowAll &&
          status === "success" &&
          items.length > 0 && (
            <SectionHeaderAction onClick={onShowAll}>
              전체 보기
            </SectionHeaderAction>
          )
        }
      />
      <div className={onShowAll ? "mt-3" : "mt-1"}>
        {status === "pending" && <ReviewListSkeleton rows={skeletonRows} />}
        {status === "error" && (
          <EmptyState
            tone="warn"
            icon={<WifiOffIcon />}
            title="리뷰를 불러오지 못했어요"
            description="인터넷 연결을 확인하고 다시 시도해 주세요."
            action={
              <Button variant="outline" size="md" onClick={onRetry}>
                다시 시도
              </Button>
            }
          />
        )}
        {status === "success" && items.length === 0 && (
          <EmptyState
            icon={<ChatIcon />}
            title="아직 리뷰가 없어요"
            description="다녀왔다면 첫 리뷰를 남겨 주세요."
          />
        )}
        {status === "success" && items.length > 0 && (
          <ul className="flex flex-col">
            {items.map((item) => (
              <ReviewRow key={item.reviewId} item={item} />
            ))}
          </ul>
        )}
        {status === "success" && isFetchingNextPage && (
          <ReviewListSkeleton rows={1} />
        )}
        {status === "success" && isFetchNextPageError && (
          <div className="flex justify-center pt-2">
            <TextButton onClick={onRetryNextPage}>다시 불러오기</TextButton>
          </div>
        )}
        {status === "success" &&
          hasNextPage &&
          !isFetchingNextPage &&
          !isFetchNextPageError && <div ref={endRef} aria-hidden="true" />}
      </div>
    </section>
  );
}

// Figma 6-03 'rv': 위아래 16, 줄 사이 8, 아래 구분선
function ReviewRow({ item }: { item: ReviewItem }) {
  return (
    <li className="flex flex-col gap-2 border-b border-line py-4">
      <time
        dateTime={item.createdAt}
        className="text-caption-md text-ink-muted"
      >
        {formatKstDate(item.createdAt)} 작성
      </time>
      {item.description === undefined ? (
        <p className="text-body-sm text-ink-subtle">내용 없이 남긴 리뷰예요</p>
      ) : (
        <p className="text-body-sm wrap-anywhere whitespace-pre-line text-ink">
          {item.description}
        </p>
      )}
    </li>
  );
}

function ReviewListSkeleton({ rows }: { rows: number }) {
  return (
    <div aria-busy="true" className="flex flex-col">
      <span className="sr-only">리뷰를 불러오는 중이에요</span>
      {Array.from({ length: rows }, (_, row) => (
        <div
          key={row}
          className="flex flex-col gap-2 border-b border-line py-4"
        >
          <div className="h-4 w-1/4 skeleton rounded-xs" />
          <div className="h-4 w-4/5 skeleton rounded-xs" />
        </div>
      ))}
    </div>
  );
}
