"use client";

import { useEffect, useRef, useState } from "react";

import { TextButton } from "@/shared/ui/button/text-button";
import { Badge } from "@/shared/ui/display/badge";
import { ChevronRightIcon } from "@/shared/ui/icon/icons/chevron-right";
import { HistoryIcon } from "@/shared/ui/icon/icons/history";
import { BottomSheet } from "@/shared/ui/overlay/bottom-sheet";

import { formatRecentAt, type SearchThread } from "../model/search-threads";
import { LoadFailed } from "./load-failed";
import { useThreadList, type ThreadAuth } from "./thread-storage";

type RecentSearchSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // 회원이면 서버 기록을 읽는다. 없으면 기기 기록이다
  threadAuth?: ThreadAuth;
  // 지금 thread. "보는 중"을 붙인다
  currentThreadId?: string;
  // 받아 온 thread로 바꾼다
  onOpenThread: (thread: SearchThread) => void;
};

// 최근 검색(와이어프레임 StartRecent). 비회원은 기기, 회원은 서버에 남긴 검색 thread 목록이다
export function RecentSearchSheet({
  open,
  onOpenChange,
  ...listProps
}: RecentSearchSheetProps) {
  return (
    <BottomSheet title="최근 검색" open={open} onOpenChange={onOpenChange}>
      <ThreadList {...listProps} onClose={() => onOpenChange(false)} />
    </BottomSheet>
  );
}

const EMPTY_MESSAGE =
  "아직 검색한 요청이 없어요. 원하는 분위기나 목적을 말해 보세요.";

// 시트가 열릴 때마다 새로 그려져 목록을 첫 페이지부터 다시 받고, "오늘"을 가르는 기준 시각도 그때 잡는다
function ThreadList({
  threadAuth,
  currentThreadId,
  onOpenThread,
  onClose,
}: Omit<RecentSearchSheetProps, "open" | "onOpenChange"> & {
  onClose: () => void;
}) {
  const { state, load } = useThreadList(threadAuth);
  const [now] = useState(() => Date.now());
  // 받는 중이거나 받지 못한 줄. 받는 동안 다른 줄을 고르면 마지막 것만 반영한다
  const [picking, setPicking] = useState<{
    id: string;
    status: "loading" | "failed";
  }>();
  const pickController = useRef<AbortController | undefined>(undefined);

  // 시트를 닫으면 받던 thread를 버린다
  useEffect(() => () => pickController.current?.abort(), []);

  async function handlePick(id: string) {
    if (id === currentThreadId) {
      onClose();
      return;
    }
    pickController.current?.abort();
    const controller = new AbortController();
    pickController.current = controller;
    setPicking({ id, status: "loading" });
    try {
      const thread = await load(id, controller.signal);
      if (!controller.signal.aborted) onOpenThread(thread);
    } catch {
      if (!controller.signal.aborted) setPicking({ id, status: "failed" });
    }
  }

  if (state.status === "loading") {
    return (
      <p aria-busy className="pt-4 pb-6 text-body-sm text-ink-muted">
        최근 검색을 불러오는 중이에요
      </p>
    );
  }
  if (state.status === "failed") {
    return (
      <LoadFailed
        error={state.error}
        title="최근 검색을 불러오지 못했어요"
        onRetry={state.retry}
        className="mb-6"
      />
    );
  }
  if (state.items.length === 0) {
    return (
      <p className="pt-4 pb-6 text-body-sm text-ink-muted">{EMPTY_MESSAGE}</p>
    );
  }
  return (
    <>
      <ul
        aria-label="최근 검색 목록"
        className="flex flex-col divide-y divide-line"
      >
        {state.items.map((thread) => {
          const loading =
            picking?.id === thread.id && picking.status === "loading";
          const failed =
            picking?.id === thread.id && picking.status === "failed";
          return (
            <li key={thread.id}>
              <button
                type="button"
                aria-busy={loading}
                onClick={() => handlePick(thread.id)}
                className="flex min-h-14 w-full items-center gap-3 py-2 text-left active:bg-surface-sunken"
              >
                <HistoryIcon size="md" className="text-icon-subtle" />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="flex items-center gap-2 text-body-md text-ink">
                    <span className="truncate">{thread.title}</span>
                    {thread.id === currentThreadId && <Badge>보는 중</Badge>}
                  </span>
                  {loading ? (
                    <span className="text-caption-md text-ink-muted">
                      불러오는 중
                    </span>
                  ) : failed ? (
                    <span role="alert" className="text-caption-md text-danger">
                      불러오지 못했어요. 눌러서 다시 시도
                    </span>
                  ) : (
                    <span className="text-caption-md text-ink-muted">
                      {formatRecentAt(thread.lastAt, now)}
                    </span>
                  )}
                </span>
                <ChevronRightIcon size="md" className="text-icon-subtle" />
              </button>
            </li>
          );
        })}
      </ul>
      {state.hasMore &&
        (state.loadMoreFailed ? (
          <div className="flex items-center justify-between gap-2 py-2">
            <p role="alert" className="text-body-sm text-danger">
              최근 검색을 더 불러오지 못했어요
            </p>
            <TextButton onClick={state.loadMore}>다시 시도</TextButton>
          </div>
        ) : (
          <div className="flex justify-center py-2">
            <TextButton
              onClick={state.loadMore}
              disabled={state.loadingMore}
              aria-busy={state.loadingMore}
            >
              더 보기
            </TextButton>
          </div>
        ))}
    </>
  );
}
