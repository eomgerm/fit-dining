import { cn } from "@/shared/lib/cn";
import { Tag } from "@/shared/ui/display/tag";

import { matchedLabels } from "../model/place-labels";
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
  const { place, score, labels, openStatus, scoreItems } = card;
  // 이번 검색에서 맞은 조건 태그만 강조한다. 채운 태그(장소 특징, 업종·역 이름)는 회색이다
  const matched = matchedLabels(scoreItems);
  return (
    // 빈 카드(PlaceCardSkeleton) 자리에 처음 그려질 때 투명도만 200ms로 나타난다. 움직임 줄이기에서는 120ms다.
    // 선택 테두리(120ms)와 시간이 달라 감싸는 쪽에서 바꾼다
    <div className="transition-opacity duration-200 motion-reduce:duration-120 starting:opacity-0">
      <button
        type="button"
        id={placeCardElementId(place.id)}
        aria-pressed={selected}
        onClick={onPress}
        // 테두리는 안쪽 그림자라 선택돼도 내용이 움직이지 않는다
        className={cn(
          "flex w-full scroll-my-4 flex-col gap-2.5 rounded-lg bg-surface p-3.5 text-left transition motion-safe:active:scale-98",
          selected
            ? "inset-ring-2 inset-ring-primary"
            : "inset-ring inset-ring-line",
        )}
      >
        <div className="flex w-full gap-3">
          <PlacePhoto
            src={place.thumbnailUrl}
            className="size-19 shrink-0 rounded-md"
          />
          {/* 태그 줄은 핏 점수 아래까지 폭을 쓴다(5-04) */}
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-start gap-2">
              <div className="flex min-w-0 flex-1 flex-col">
                <div className="flex items-center gap-1.5">
                  <RankBadge rank={rank} selected={selected} />
                  <span className="truncate text-title-md text-ink">
                    {place.name}
                  </span>
                </div>
                <PlaceMeta place={place} here={here} status={openStatus} />
              </div>
              {score !== undefined && <FitScore score={score} />}
            </div>
            <div className="flex flex-wrap gap-1">
              {labels.map((label) => (
                <Tag
                  key={label}
                  variant={matched.has(label) ? "match" : "default"}
                >
                  {label}
                </Tag>
              ))}
            </div>
          </div>
        </div>
      </button>
    </div>
  );
}

// 검색 중(5-03)의 빈 카드 자리. 이름, 정보 줄, 태그 두 칸
export function PlaceCardSkeleton() {
  return (
    <div className="flex gap-3 rounded-lg p-3.5 inset-ring inset-ring-line">
      <div className="size-19 shrink-0 skeleton rounded-md" />
      <div className="flex flex-1 flex-col gap-2.5 pt-1">
        <div className="h-4.5 w-3/5 skeleton rounded-sm" />
        <div className="h-3 w-2/5 skeleton rounded-sm" />
        <div className="flex gap-1.5">
          <div className="h-5.5 w-21 skeleton rounded-sm" />
          <div className="h-5.5 w-17.5 skeleton rounded-sm" />
        </div>
      </div>
    </div>
  );
}
