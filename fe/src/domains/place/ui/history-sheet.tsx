"use client";

import { Button } from "@/shared/ui/button/button";
import { Badge } from "@/shared/ui/display/badge";
import { BottomSheet } from "@/shared/ui/overlay/bottom-sheet";
import { cn } from "@/shared/lib/cn";

import { continuedFrom, historyMeta } from "../model/search-store";
import { useSearchStore } from "./use-search-store";

type HistorySheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  // 닫힘 애니메이션이 끝난 뒤. 시트가 초점을 되돌린 다음에 후속 입력창으로 옮길 때 쓴다
  onOpenChangeComplete?: (open: boolean) => void;
  // "결과 보기". 네트워크 요청 없이 그 요청의 결과로 바꾼다
  onView: (entryId: string) => void;
  // "여기서 이어 검색". 그 요청의 결과로 바꾸고 후속 입력창에 초점을 둔다
  onContinue: (entryId: string) => void;
};

// 이번 페이지 세션의 요청 기록(5-07)
export function HistorySheet({
  open,
  onOpenChange,
  onOpenChangeComplete,
  onView,
  onContinue,
}: HistorySheetProps) {
  const { entries, viewingId } = useSearchStore();

  return (
    <BottomSheet
      title="요청 기록"
      open={open}
      onOpenChange={onOpenChange}
      onOpenChangeComplete={onOpenChangeComplete}
    >
      <ol className="flex flex-col">
        {entries.map((entry, index) => {
          const viewing = entry.id === viewingId;
          const from = continuedFrom(entries, entry);
          return (
            <li key={entry.id} className="relative flex gap-3 pb-5">
              {/* 시간순을 잇는 세로선 */}
              {index < entries.length - 1 && (
                <span
                  aria-hidden
                  className="absolute top-6 bottom-0 left-2.5 w-px bg-line-strong"
                />
              )}
              <span
                aria-hidden
                className={cn(
                  "mt-0.5 size-5 shrink-0 rounded-full border-2",
                  viewing
                    ? "border-primary bg-primary"
                    : "border-icon bg-surface",
                )}
              />
              <div
                className={cn(
                  "flex min-w-0 flex-1 flex-col gap-1",
                  viewing && "-mt-2 rounded-md bg-surface-warm p-3",
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
                  <div className="mt-1.5 flex gap-2">
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
    </BottomSheet>
  );
}
