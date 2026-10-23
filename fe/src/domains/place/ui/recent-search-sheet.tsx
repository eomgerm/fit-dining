"use client";

import { useState } from "react";

import { ChevronRightIcon } from "@/shared/ui/icon/icons/chevron-right";
import { HistoryIcon } from "@/shared/ui/icon/icons/history";
import { BottomSheet } from "@/shared/ui/overlay/bottom-sheet";

import { formatRecentAt } from "../model/recent-searches";
import { useRecentSearches } from "./use-recent-searches";

type RecentSearchSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // 고른 문장으로 새 검색을 보낸다
  onPick: (sentence: string) => void;
};

// 기기에 남긴 최근 검색(와이어프레임 StartRecent). 이번 세션의 요청 기록(5-07)과는 다르다
export function RecentSearchSheet({
  open,
  onOpenChange,
  onPick,
}: RecentSearchSheetProps) {
  return (
    <BottomSheet title="최근 검색" open={open} onOpenChange={onOpenChange}>
      <RecentList onPick={onPick} />
    </BottomSheet>
  );
}

// 시트가 열릴 때마다 새로 그려져 "오늘"을 가르는 기준 시각도 그때 잡는다
function RecentList({ onPick }: { onPick: (sentence: string) => void }) {
  const recent = useRecentSearches();
  const [now] = useState(() => Date.now());

  if (recent.length === 0) {
    return (
      <p className="pt-4 pb-6 text-body-sm text-ink-muted">
        아직 검색한 요청이 없어요. 원하는 분위기나 목적을 말해 보세요.
      </p>
    );
  }
  return (
    <ul aria-label="최근 검색 목록" className="flex flex-col">
      {recent.map(({ sentence, at }) => (
        <li key={sentence}>
          <button
            type="button"
            onClick={() => onPick(sentence)}
            className="flex w-full items-center gap-3 py-3 text-left active:bg-surface-sunken"
          >
            <HistoryIcon size="md" className="text-icon-subtle" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate text-body-md text-ink">{sentence}</span>
              <span className="text-caption-md text-ink-muted">
                {formatRecentAt(at, now)}
              </span>
            </span>
            <ChevronRightIcon size="md" className="text-icon-subtle" />
          </button>
        </li>
      ))}
    </ul>
  );
}
