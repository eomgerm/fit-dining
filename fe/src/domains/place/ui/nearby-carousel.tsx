"use client";

import { cn } from "@/shared/lib/cn";
import { Carousel } from "@/shared/ui/display/carousel";
import { Tag } from "@/shared/ui/display/tag";

import { matchedLabels } from "../model/place-labels";
import type { LatLng, PlaceCard } from "../model/place-types";
import { FitScore } from "./fit-score";
import { PlaceMeta, PlacePhoto, RankBadge } from "./place-parts";

type NearbyCarouselProps = {
  cards: PlaceCard[];
  // 선택된 카드
  selectedId: number;
  // 기기 위치. 있을 때만 거리를 보인다(spec 55번)
  here?: LatLng;
  // 넘기거나 가운데가 아닌 카드를 눌러 선택이 바뀔 때
  onSelect: (card: PlaceCard) => void;
  // 선택된 카드를 누를 때. 상세로 간다
  onOpen: (card: PlaceCard) => void;
};

// 첫 화면 검색창 위의 주변 추천 카드(와이어프레임 Start)
export function NearbyCarousel({
  cards,
  selectedId,
  here,
  onSelect,
  onOpen,
}: NearbyCarouselProps) {
  const index = Math.max(
    0,
    cards.findIndex(({ place }) => place.id === selectedId),
  );

  return (
    <Carousel
      label="주변 추천 장소"
      index={index}
      // 목록이 바뀌어 다시 맞출 때처럼 선택이 그대로면 지도를 옮기지 않는다
      onIndexChange={(next) => {
        const card = cards[next];
        if (card && card.place.id !== selectedId) onSelect(card);
      }}
      // 640px(sm) 미만은 칸이 틀 안쪽을 꽉 채워, 카드가 검색창처럼 화면 좌우 16px(틀 여백 12px + 칸 여백 4px)에 놓이고
      // 이웃 카드가 양옆 틀 여백에 비친다. 그 이상은 칸 320px이 틀 안쪽에서 8px 들어가 카드가 화면 왼쪽 24px에 놓인다(D-103)
      peek
      options={{
        align: (viewSize, snapSize) => (snapSize < viewSize ? 8 : 0),
      }}
      slideClassName="basis-full sm:basis-80"
      // 칸 위아래 여유(py-1)만큼 당긴다. 아래는 2px 덜 당겨 검색창과 14px 띄운다
      className="-mt-1 -mb-0.5"
    >
      {cards.map((card, cardIndex) => {
        const selected = card.place.id === selectedId;
        return (
          // 칸 좌우 여백 4px씩으로 카드 사이를 8px 띄운다. 위아래 여유는 카드 밖 선택 링이 잘리지 않게 한다
          <div key={card.place.id} className="px-1 py-1">
            <NearbyCard
              card={card}
              rank={cardIndex + 1}
              selected={selected}
              here={here}
              onPress={() => (selected ? onOpen(card) : onSelect(card))}
            />
          </div>
        );
      })}
    </Carousel>
  );
}

function NearbyCard({
  card,
  rank,
  selected,
  here,
  onPress,
}: {
  card: PlaceCard;
  rank: number;
  selected: boolean;
  here?: LatLng;
  onPress: () => void;
}) {
  const { place, score, labels, openStatus, scoreItems } = card;
  // 검색 결과 카드와 같은 규칙이다. 비회원은 scoreItems가 비어 태그가 대부분 회색이다(spec 55번)
  const matched = matchedLabels(scoreItems);
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onPress}
      // 선택은 카드 밖 2px 링이다(4-01)
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-lg bg-surface text-left shadow-2 transition-transform motion-safe:active:scale-98",
        selected && "outline-2 outline-offset-2 outline-primary",
      )}
    >
      <PlacePhoto src={place.thumbnailUrl} className="h-30 w-full" />
      <div className="flex w-full flex-col gap-2 px-3.5 pt-3 pb-3.5">
        <div className="flex gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
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
            <Tag key={label} variant={matched.has(label) ? "match" : "default"}>
              {label}
            </Tag>
          ))}
        </div>
      </div>
    </button>
  );
}

// 홈 영역을 확정하고 카드를 받기 전의 자리(spec 73번). 실제 카드와 같은 틀과 줄 높이로 그려 아래 묶음 높이가
// 바뀌지 않게 한다. 휴대폰 폭에서는 카드처럼 화면 좌우 16px, 넓은 폭에서는 320px 카드가 왼쪽 24px에 놓인다
export function NearbyCarouselSkeleton() {
  return (
    <div
      role="status"
      aria-label="주변 추천을 불러오는 중"
      className="px-4 sm:px-6"
    >
      <div className="flex w-full flex-col overflow-hidden rounded-lg bg-surface shadow-2 sm:w-80">
        <div className="h-30 w-full skeleton" />
        <div className="flex w-full flex-col gap-2 px-3.5 pt-3 pb-3.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-title-md">
              <span className="inline-block w-3/5 skeleton rounded-sm text-transparent">
                &nbsp;
              </span>
            </span>
            <span className="text-caption-md">
              <span className="inline-block w-2/5 skeleton rounded-sm text-transparent">
                &nbsp;
              </span>
            </span>
          </div>
          <div aria-hidden className="invisible flex gap-1">
            <Tag variant="match">&nbsp;</Tag>
          </div>
        </div>
      </div>
    </div>
  );
}
