import type { ReactNode, Ref } from "react";

import { Button } from "@/shared/ui/button/button";
import { IconButton } from "@/shared/ui/button/icon-button";
import { TextButton } from "@/shared/ui/button/text-button";
import { Badge } from "@/shared/ui/display/badge";
import { EmptyState } from "@/shared/ui/display/empty-state";
import { Tag } from "@/shared/ui/display/tag";
import { ChatIcon } from "@/shared/ui/icon/icons/chat";
import { CheckIcon } from "@/shared/ui/icon/icons/check";
import { ChevronRightIcon } from "@/shared/ui/icon/icons/chevron-right";
import { MoreIcon } from "@/shared/ui/icon/icons/more";
import { WifiOffIcon } from "@/shared/ui/icon/icons/wifi-off";
import { SectionHeader } from "@/shared/ui/layout/section-header";
import { Menu, MenuItem } from "@/shared/ui/overlay/menu";
import { cn } from "@/shared/lib/cn";

import {
  authorLabel,
  formatVisitedDay,
  type ReviewItem,
} from "../model/review";

export type ReviewListViewProps = {
  status: "pending" | "error" | "success";
  // 불러온 뒤에만 있다
  totalCount?: number;
  items: ReviewItem[];
  // 있으면 홈 탭 미리보기다. 머리글 "리뷰 N >"가 이 함수를 부르는 버튼이 된다. 리뷰가 없으면 버튼이 아니다
  onShowAll?: () => void;
  // 둘 다 있으면 내 리뷰에 ⋯ 메뉴(수정하기·삭제하기, 6-06)를 둔다
  onEdit?: (reviewId: number) => void;
  onDelete?: (reviewId: number) => void;
  // 있으면 남의 리뷰에 ⋯ 메뉴(신고하기, 6-10)를 둔다. 로그인하지 않았으면 모든 리뷰가 남의 리뷰다
  onReport?: (reviewId: number) => void;
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
  // 리뷰 섹션. 삭제 확인 창이 닫힐 때 지운 리뷰의 ⋯ 버튼 대신 여기로 포커스를 보낸다
  ref?: Ref<HTMLElement>;
  className?: string;
};

// 리뷰 탭(6-03)과 홈 탭 미리보기(6-01)가 함께 쓰는 목록 화면.
// 데이터 훅과 나눠 상태별 모양을 정적으로 확인한다(D-31, D-32)
export function ReviewListView({
  status,
  totalCount,
  items,
  onShowAll,
  onEdit,
  onDelete,
  onReport,
  skeletonRows = 3,
  onRetry,
  hasNextPage = false,
  isFetchingNextPage = false,
  isFetchNextPageError = false,
  onRetryNextPage,
  endRef,
  ref,
  className,
}: ReviewListViewProps) {
  const count = status === "success" ? totalCount : undefined;
  const loaded = status === "success" && items.length > 0;
  return (
    <section
      ref={ref}
      aria-label="리뷰"
      tabIndex={-1}
      className={cn("flex flex-col outline-none", className)}
    >
      {onShowAll && loaded ? (
        // 6-01: 같은 홈 탭의 "메뉴 N >"처럼 머리글 전체가 리뷰 탭을 여는 버튼이다
        <h2>
          <button
            type="button"
            onClick={onShowAll}
            className="-my-2 flex min-h-11 items-center gap-0.5 text-title-lg text-ink"
          >
            리뷰
            <span className="ml-1.5 text-ink-muted">{count}</span>
            <ChevronRightIcon size="md" />
          </button>
        </h2>
      ) : (
        <SectionHeader
          title="리뷰"
          count={count}
          action={
            !onShowAll &&
            loaded && (
              // 정렬은 최신순 하나뿐이라 누를 수 없는 글자로 둔다
              <span className="self-center text-caption-md text-ink-muted">
                최신순
              </span>
            )
          }
        />
      )}
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
              <ReviewRow
                key={item.reviewId}
                item={item}
                onEdit={onEdit}
                onDelete={onDelete}
                onReport={onReport}
              />
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

// 화면에서는 간격으로 떨어지지만 스크린리더가 "아쉬움대기가 길었어요"로 붙여 읽지 않게 공백을 둔다
const BAD_PREFIX = (
  <>
    아쉬움<span className="sr-only"> </span>
  </>
);

// Figma 6-03 'rv': 위아래 16, 줄 사이 8, 아래 구분선.
// 내 리뷰는 닉네임 옆에 "내 리뷰" 태그를 붙인다(6-06).
// 좋았어요 태그는 강조 태그, 아쉬웠어요 태그는 앞에 "아쉬움"을 붙인 기본 태그다(D-24)
function ReviewRow({
  item,
  onEdit,
  onDelete,
  onReport,
}: {
  item: ReviewItem;
  onEdit?: (reviewId: number) => void;
  onDelete?: (reviewId: number) => void;
  onReport?: (reviewId: number) => void;
}) {
  const day = formatVisitedDay(item.visitedAt);
  return (
    <li className="flex flex-col gap-2 border-b border-line py-4">
      <div className="flex min-w-0 items-center gap-2">
        <p className="truncate text-title-sm text-ink">{authorLabel(item)}</p>
        {item.mine && <Tag>내 리뷰</Tag>}
        {item.revisitIntent && (
          <Badge icon={<CheckIcon size="md" />}>재방문 의사 있어요</Badge>
        )}
        {item.mine && onEdit && onDelete && (
          // 같은 장소에 방문일만 다른 내 리뷰가 여럿일 수 있어 방문일로 구분한다
          <ReviewMenu label={`${day} 리뷰 메뉴`}>
            <MenuItem onClick={() => onEdit(item.reviewId)}>수정하기</MenuItem>
            <MenuItem tone="danger" onClick={() => onDelete(item.reviewId)}>
              삭제하기
            </MenuItem>
          </ReviewMenu>
        )}
        {!item.mine && onReport && (
          // 같은 날 여러 사람이 남길 수 있어 작성자도 붙인다
          <ReviewMenu label={`${authorLabel(item)}의 ${day} 리뷰 메뉴`}>
            <MenuItem onClick={() => onReport(item.reviewId)}>
              신고하기
            </MenuItem>
          </ReviewMenu>
        )}
      </div>
      <time
        dateTime={item.visitedAt}
        className="text-caption-md text-ink-muted"
      >
        {formatVisitedDay(item.visitedAt)}
      </time>
      {item.tags.length > 0 && (
        <ul className="flex flex-wrap gap-1">
          {item.tags.map((tag) => (
            <li key={tag.code}>
              <Tag
                variant={tag.sentiment === "GOOD" ? "match" : "default"}
                prefix={tag.sentiment === "BAD" ? BAD_PREFIX : undefined}
              >
                {tag.label}
              </Tag>
            </li>
          ))}
        </ul>
      )}
      {item.description === undefined ? (
        // 태그도 없는 예전 리뷰(Walking Skeleton)만 안내 문구를 보인다
        item.tags.length === 0 && (
          <p className="text-body-sm text-ink-subtle">
            내용 없이 남긴 리뷰예요
          </p>
        )
      ) : (
        <p className="text-body-sm wrap-anywhere whitespace-pre-line text-ink">
          {item.description}
        </p>
      )}
    </li>
  );
}

function ReviewMenu({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="-my-1.5 -mr-2.5 ml-auto">
      <Menu
        trigger={
          <IconButton label={label}>
            <MoreIcon size="md" className="text-ink-muted" />
          </IconButton>
        }
      >
        {children}
      </Menu>
    </div>
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
