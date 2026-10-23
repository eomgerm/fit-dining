"use client";

import { useState } from "react";

import { Badge } from "@/shared/ui/display/badge";
import { ChevronRightIcon } from "@/shared/ui/icon/icons/chevron-right";
import { HistoryIcon } from "@/shared/ui/icon/icons/history";
import { BottomSheet } from "@/shared/ui/overlay/bottom-sheet";

import {
  formatRecentAt,
  threadTitle,
  threadUpdatedAt,
} from "../model/search-threads";
import { useThreads } from "./thread-storage";

type RecentSearchSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // 지금 thread. "보는 중"을 붙인다
  currentThreadId?: string;
  // 고른 thread로 바꾼다
  onPick: (threadId: string) => void;
};

// 최근 검색(와이어프레임 StartRecent). 기기에 남긴 검색 thread 목록이다
export function RecentSearchSheet({
  open,
  onOpenChange,
  currentThreadId,
  onPick,
}: RecentSearchSheetProps) {
  return (
    <BottomSheet title="최근 검색" open={open} onOpenChange={onOpenChange}>
      <ThreadList currentThreadId={currentThreadId} onPick={onPick} />
    </BottomSheet>
  );
}

// 시트가 열릴 때마다 새로 그려져 "오늘"을 가르는 기준 시각도 그때 잡는다
function ThreadList({
  currentThreadId,
  onPick,
}: Pick<RecentSearchSheetProps, "currentThreadId" | "onPick">) {
  const threads = useThreads();
  const [now] = useState(() => Date.now());

  if (threads.length === 0) {
    return (
      <p className="pt-4 pb-6 text-body-sm text-ink-muted">
        아직 검색한 요청이 없어요. 원하는 분위기나 목적을 말해 보세요.
      </p>
    );
  }
  return (
    <ul
      aria-label="최근 검색 목록"
      className="flex flex-col divide-y divide-line"
    >
      {threads.map((thread) => (
        <li key={thread.id}>
          <button
            type="button"
            onClick={() => onPick(thread.id)}
            className="flex min-h-14 w-full items-center gap-3 py-2 text-left active:bg-surface-sunken"
          >
            <HistoryIcon size="md" className="text-icon-subtle" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-center gap-2 text-body-md text-ink">
                <span className="truncate">{threadTitle(thread)}</span>
                {thread.id === currentThreadId && <Badge>보는 중</Badge>}
              </span>
              <span className="text-caption-md text-ink-muted">
                {formatRecentAt(threadUpdatedAt(thread), now)}
              </span>
            </span>
            <ChevronRightIcon size="md" className="text-icon-subtle" />
          </button>
        </li>
      ))}
    </ul>
  );
}
