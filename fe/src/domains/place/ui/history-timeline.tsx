"use client";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button/button";
import { Badge } from "@/shared/ui/display/badge";

import { continuedFrom, historyMeta } from "../model/search-store";
import { useSearchStore } from "./use-search-store";

type HistoryTimelineProps = {
  // "결과 보기". 지금 보는 요청은 그대로 두고 과거 결과 화면을 연다
  onView: (entryId: string) => void;
  // "여기서 이어 검색". 그 요청을 지금 보는 요청으로 바꾸고 후속 입력창에 초점을 둔다
  onContinue: (entryId: string) => void;
};

// 지금 thread의 요청 기록(5-07, 와이어프레임 RequestHistory). 결과 패널 안에 펼친다
export function HistoryTimeline({ onView, onContinue }: HistoryTimelineProps) {
  const { entries, viewingId } = useSearchStore();

  return (
    <ol aria-label="요청 기록" className="flex flex-col px-4 pt-1">
      {entries.map((entry, index) => {
        const viewing = entry.id === viewingId;
        const from = continuedFrom(entries, entry);
        return (
          <li key={entry.id} className="relative flex gap-3 pb-5">
            {/* 시간순을 잇는 세로선 */}
            {index < entries.length - 1 && (
              <span
                aria-hidden
                className="absolute top-6 bottom-0 left-3 w-px bg-line-strong"
              />
            )}
            <span
              aria-hidden
              className={cn(
                "relative size-6 shrink-0 rounded-full border-1.5",
                viewing
                  ? "border-primary bg-primary"
                  : "border-ink-subtle bg-surface",
              )}
            />
            <div
              className={cn(
                "flex min-w-0 flex-1 flex-col gap-1.5",
                viewing && "-mt-2.5 rounded-md bg-surface-warm px-3 py-2.5",
              )}
            >
              <p className="flex items-center gap-2 text-title-sm text-ink">
                <span className="truncate">{entry.sentence}</span>
                {viewing && <Badge>보는 중</Badge>}
              </p>
              <p className="text-caption-md text-ink-muted">
                {historyMeta(entry)}
                {from && ` · ${from}`}
              </p>
              {!viewing && (
                <div className="mt-0.5 flex gap-1.5">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onView(entry.id)}
                  >
                    결과 보기
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onContinue(entry.id)}
                  >
                    여기서 이어 검색
                  </Button>
                </div>
              )}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
