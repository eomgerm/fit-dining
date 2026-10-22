import { cn } from "@/shared/lib/cn";
import { Tag } from "@/shared/ui/display/tag";
import { WarningIcon } from "@/shared/ui/icon/icons/warning";

import type { LatLng, PlaceCard as PlaceCardData } from "../model/place-types";
import { FitScore } from "./fit-score";
import { PlaceMeta, PlacePhoto, RankBadge } from "./place-parts";

type PlaceCardProps = {
  card: PlaceCardData;
  // 지금 보이는 목록에서의 순서(1부터)
  rank: number;
  selected: boolean;
  here?: LatLng;
  onPress: () => void;
};

export function placeCardElementId(placeId: number) {
  return `place-card-${placeId}`;
}

// 추천 결과 카드(5-04). 처음 누르면 선택하고, 선택된 카드를 다시 누르면 상세로 간다
export function PlaceCard({
  card,
  rank,
  selected,
  here,
  onPress,
}: PlaceCardProps) {
  const { place, score, labels, caution, openStatus } = card;
  return (
    <button
      type="button"
      id={placeCardElementId(place.id)}
      aria-pressed={selected}
      onClick={onPress}
      className={cn(
        "flex w-full scroll-my-4 flex-col gap-3 rounded-lg border bg-surface p-4 text-left transition-colors",
        selected ? "border-1.5 border-primary" : "border-line",
      )}
    >
      <div className="flex w-full gap-3">
        <PlacePhoto
          src={place.thumbnailUrl}
          className="size-19 shrink-0 rounded-md"
        />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex items-center gap-2">
            <RankBadge rank={rank} selected={selected} />
            <span className="truncate text-title-md text-ink">
              {place.name}
            </span>
          </div>
          <PlaceMeta place={place} here={here} status={openStatus} />
          <div className="mt-1 flex flex-wrap gap-1">
            {labels.map((label, index) => (
              <Tag key={label} variant={index === 0 ? "match" : "default"}>
                {label}
              </Tag>
            ))}
          </div>
        </div>
        <FitScore score={score} />
      </div>
      {caution && (
        <p className="flex items-center gap-1.5 text-caption-md text-warning">
          <WarningIcon size="sm" />
          {caution}
        </p>
      )}
    </button>
  );
}

// 검색 중(5-03)의 빈 카드 자리
export function PlaceCardSkeleton() {
  return (
    <div className="flex gap-3 rounded-lg border border-line p-4">
      <div className="size-19 shrink-0 skeleton rounded-md" />
      <div className="flex flex-1 flex-col gap-2 pt-1">
        <div className="h-5 w-2/3 skeleton rounded-xs" />
        <div className="h-4 w-1/2 skeleton rounded-xs" />
        <div className="h-6 w-3/4 skeleton rounded-xs" />
      </div>
    </div>
  );
}
