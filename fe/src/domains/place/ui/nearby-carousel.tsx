"use client";

import { cn } from "@/shared/lib/cn";
import { Carousel } from "@/shared/ui/display/carousel";
import { Tag } from "@/shared/ui/display/tag";

import type { LatLng, PlaceCard } from "../model/place-types";
import { FitScore } from "./fit-score";
import { PlaceMeta, PlacePhoto, RankBadge } from "./place-parts";

type NearbyCarouselProps = {
  cards: PlaceCard[];
  // 가운데에 있는 선택된 카드
  selectedId: number;
  // 거리의 기준 지점과, 기기 위치가 아닐 때 거리 앞에 붙는 이름
  origin: LatLng;
  originLabel?: string;
  // 넘기거나 가운데가 아닌 카드를 눌러 선택이 바뀔 때
  onSelect: (card: PlaceCard) => void;
  // 선택된 카드를 누를 때. 상세로 간다
  onOpen: (card: PlaceCard) => void;
};

// 첫 화면 검색창 위의 주변 추천 카드(와이어프레임 Start). 가운데 카드가 선택된 카드다
export function NearbyCarousel({
  cards,
  selectedId,
  origin,
  originLabel,
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
      options={{ align: "start" }}
      slideClassName="basis-82"
    >
      {cards.map((card, cardIndex) => {
        const selected = card.place.id === selectedId;
        return (
          // 칸 안쪽 여백으로 카드 사이를 띄운다. 첫 카드도 화면 왼쪽에서 같은 만큼 떨어진다
          <div key={card.place.id} className="pl-4">
            <NearbyCard
              card={card}
              rank={cardIndex + 1}
              selected={selected}
              origin={origin}
              originLabel={originLabel}
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
  origin,
  originLabel,
  onPress,
}: {
  card: PlaceCard;
  rank: number;
  selected: boolean;
  origin: LatLng;
  originLabel?: string;
  onPress: () => void;
}) {
  const { place, score, labels, openStatus } = card;
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onPress}
      className={cn(
        "flex w-full flex-col overflow-hidden rounded-lg border bg-surface text-left shadow-2 transition-colors",
        selected ? "border-1.5 border-primary" : "border-line",
      )}
    >
      <PlacePhoto src={place.thumbnailUrl} className="h-30 w-full" />
      <div className="flex w-full flex-col gap-2 p-4">
        <div className="flex gap-2">
          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <RankBadge rank={rank} selected={selected} />
              <span className="truncate text-title-md text-ink">
                {place.name}
              </span>
            </div>
            <PlaceMeta
              place={place}
              here={origin}
              hereLabel={originLabel}
              status={openStatus}
            />
          </div>
          {score !== undefined && <FitScore score={score} />}
        </div>
        <div className="flex flex-wrap gap-1">
          {labels.map((label, labelIndex) => (
            <Tag key={label} variant={labelIndex === 0 ? "match" : "default"}>
              {label}
            </Tag>
          ))}
        </div>
      </div>
    </button>
  );
}
