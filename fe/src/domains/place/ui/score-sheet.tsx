"use client";

import { CheckIcon } from "@/shared/ui/icon/icons/check";
import { InfoIcon } from "@/shared/ui/icon/icons/info";
import { BottomSheet } from "@/shared/ui/overlay/bottom-sheet";

import { evidenceText } from "../model/place-labels";
import type { PlaceCard } from "../model/place-types";

type ScoreSheetProps = {
  card: PlaceCard;
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

// 핏 점수 설명(6-05). 점수를 이루는 항목과 근거를 보여 준다
export function ScoreSheet({ card, open, onOpenChange }: ScoreSheetProps) {
  return (
    <BottomSheet
      title={`핏 점수 ${card.score}`}
      open={open}
      onOpenChange={onOpenChange}
    >
      <p className="text-body-sm text-ink-muted">
        요청과 내 취향에 맞는 정도를 앱 리뷰로 확인해 매긴 점수예요.
      </p>
      <ul className="mt-4 flex flex-col gap-4">
        {card.scoreItems.map((item) => (
          <li key={`${item.source}-${item.label}`} className="flex gap-3">
            {item.matched ? (
              <CheckIcon size="md" className="mt-0.5 text-success" />
            ) : (
              <InfoIcon size="md" className="mt-0.5 text-ink-muted" />
            )}
            <div className="flex flex-col gap-0.5">
              <span className="text-title-sm text-ink">
                {evidenceText(item.source, item.label)}
              </span>
              <span className="text-caption-md text-ink-muted">
                {item.matched
                  ? `앱 리뷰 ${item.evidenceCount}개가 근거예요`
                  : "확인할 근거가 부족해서 점수에 넣지 않았어요"}
              </span>
            </div>
          </li>
        ))}
      </ul>
    </BottomSheet>
  );
}
