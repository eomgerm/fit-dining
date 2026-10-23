"use client";

import { useEffect, useEffectEvent, useRef, type ReactNode } from "react";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button/button";
import { TextButton } from "@/shared/ui/button/text-button";
import { Badge } from "@/shared/ui/display/badge";
import { EmptyState } from "@/shared/ui/display/empty-state";
import { Note } from "@/shared/ui/display/note";
import { Tag } from "@/shared/ui/display/tag";
import { ChevronDownIcon } from "@/shared/ui/icon/icons/chevron-down";
import { ChevronUpIcon } from "@/shared/ui/icon/icons/chevron-up";
import { MapIcon } from "@/shared/ui/icon/icons/map";
import { PlusIcon } from "@/shared/ui/icon/icons/plus";
import { RequestHistoryIcon } from "@/shared/ui/icon/icons/request-history";
import { SearchIcon } from "@/shared/ui/icon/icons/search";
import { SparkleIcon } from "@/shared/ui/icon/icons/sparkle";

import type {
  LatLng,
  PlaceCard as PlaceCardData,
  PlaceSearchResponse,
} from "../model/place-types";
import { PlaceCard, PlaceCardSkeleton } from "./place-card";
import { SearchSteps } from "./search-steps";

// 중간(5-04), 전체(5-05), 요청 기록 펼침(와이어프레임 RequestHistory)
export type PanelState = "middle" | "full" | "history";

// 손잡이를 이만큼 끌면 상태를 바꾼다
const DRAG_THRESHOLD_PX = 30;

type ResultPanelProps = {
  state: PanelState;
  onStateChange: (state: PanelState) => void;
  // 지금 보이는 문장. 검색 중이면 보낸 문장, 아니면 지금 보는 요청의 문장
  sentence: string;
  // 첫 페이지를 받는 중(5-03)
  searching: boolean;
  firstPage?: PlaceSearchResponse;
  chips: string[];
  cards: PlaceCardData[];
  selectedId?: number;
  here?: LatLng;
  locating: boolean;
  unfilteredNearby: boolean;
  hasNextPage: boolean;
  onLoadMore: () => void;
  // 다음 페이지를 받지 못했을 때
  loadMoreFailed: boolean;
  onCardPress: (card: PlaceCardData) => void;
  onNewSearch: () => void;
  // 요청 기록을 펼치거나 접는다
  onToggleHistory: () => void;
  // 요청 기록을 펼쳤을 때 결과 목록 자리에 그린다
  history: ReactNode;
  // 오류 문구 한 줄
  message?: ReactNode;
  // 패널 아래 고정되는 후속 입력창
  footer: ReactNode;
  // 패널 위쪽 가장자리에 붙는 지도 버튼("내 위치")
  edge?: ReactNode;
};

// 지도 위에 늘 떠 있는 결과 패널. 중간(5-04)과 전체(5-05) 두 상태다. 모달이 아니라 BottomSheet를 쓰지 않는다
export function ResultPanel({
  state,
  onStateChange,
  sentence,
  searching,
  firstPage,
  chips,
  cards,
  selectedId,
  here,
  locating,
  unfilteredNearby,
  hasNextPage,
  onLoadMore,
  loadMoreFailed,
  onCardPress,
  onNewSearch,
  onToggleHistory,
  history,
  message,
  footer,
  edge,
}: ResultPanelProps) {
  const dragStartY = useRef<number | undefined>(undefined);
  const full = state === "full";
  const historyOpen = state === "history";

  return (
    <section
      aria-label="추천 결과"
      className={cn(
        "absolute inset-x-0 bottom-0 flex flex-col bg-surface shadow-sheet transition-all duration-320 ease-enter",
        full && "h-full",
        state === "middle" && "h-3/5 rounded-t-xl",
        // 지도 위 버튼(저장한 장소, 내 정보) 아래까지 펼친다
        historyOpen && "top-30 rounded-t-xl",
      )}
    >
      {state === "middle" && edge && (
        <div className="absolute right-4 bottom-full mb-3">{edge}</div>
      )}
      <button
        type="button"
        aria-label={state === "middle" ? "패널 펼치기" : "패널 줄이기"}
        onClick={() => onStateChange(state === "middle" ? "full" : "middle")}
        onPointerDown={(event) => (dragStartY.current = event.clientY)}
        onPointerUp={(event) => {
          if (dragStartY.current === undefined) return;
          const delta = event.clientY - dragStartY.current;
          dragStartY.current = undefined;
          if (delta < -DRAG_THRESHOLD_PX) onStateChange("full");
          if (delta > DRAG_THRESHOLD_PX) onStateChange("middle");
        }}
        className="flex h-6 shrink-0 touch-none items-center justify-center"
      >
        <span className="h-1 w-9 rounded-full bg-line-strong" />
      </button>

      <div className="flex shrink-0 items-center justify-between px-4">
        <button
          type="button"
          aria-expanded={historyOpen}
          onClick={onToggleHistory}
          className="-ml-1 flex h-11 items-center gap-1.5 px-1 text-label-md text-ink"
        >
          {!historyOpen && (
            <RequestHistoryIcon size="md" className="text-icon" />
          )}
          요청 기록
          {historyOpen ? (
            <ChevronUpIcon size="sm" className="text-icon" />
          ) : (
            <ChevronDownIcon size="sm" className="text-icon" />
          )}
        </button>
        <button
          type="button"
          onClick={onNewSearch}
          className="-mr-1 flex h-11 items-center gap-1 px-1 text-label-md text-ink-muted"
        >
          <PlusIcon size="sm" />새 검색
        </button>
      </div>

      {historyOpen ? (
        <div className="min-h-0 flex-1 overflow-y-auto pb-4">{history}</div>
      ) : (
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
          {!searching && firstPage?.changeSummary && (
            <Badge icon={<SparkleIcon size="sm" />} className="self-start">
              {firstPage.changeSummary}
            </Badge>
          )}
          <h2 className="text-title-md text-ink">“{sentence}”</h2>
          {!searching && chips.length > 0 && (
            <div className="flex flex-wrap gap-1">
              {chips.map((chip, index) => (
                <Tag key={index}>추가 조건 · {chip}</Tag>
              ))}
            </div>
          )}
          {message}
          <PanelResults
            searching={searching}
            firstPage={firstPage}
            cards={cards}
            selectedId={selectedId}
            here={here}
            locating={locating}
            unfilteredNearby={unfilteredNearby}
            hasNextPage={hasNextPage}
            onLoadMore={onLoadMore}
            loadMoreFailed={loadMoreFailed}
            onCardPress={onCardPress}
          />
        </div>
      )}

      {full && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => onStateChange("middle")}
          className="absolute bottom-22 left-1/2 -translate-x-1/2"
        >
          <MapIcon size="sm" className="mr-1" />
          지도 보기
        </Button>
      )}
      <div className="shrink-0 border-t border-line px-3 py-2">{footer}</div>
    </section>
  );
}

// 결과 목록. 과거 결과 화면도 다음 페이지 없이 같은 목록을 쓴다
export function PanelResults({
  searching,
  firstPage,
  cards,
  selectedId,
  here,
  locating,
  unfilteredNearby,
  hasNextPage,
  onLoadMore,
  loadMoreFailed,
  onCardPress,
}: Pick<
  ResultPanelProps,
  | "searching"
  | "firstPage"
  | "cards"
  | "selectedId"
  | "here"
  | "locating"
  | "unfilteredNearby"
  | "hasNextPage"
  | "onLoadMore"
  | "loadMoreFailed"
  | "onCardPress"
>) {
  if (searching) {
    return (
      <div aria-busy className="flex flex-col gap-3">
        <SearchSteps />
        <PlaceCardSkeleton />
        <PlaceCardSkeleton />
        <PlaceCardSkeleton />
      </div>
    );
  }
  if (!firstPage) return null;
  if (firstPage.emptyReason) {
    return (
      <EmptyState
        icon={<SearchIcon />}
        title={firstPage.emptyReason.cause}
        description={firstPage.emptyReason.suggestion}
      />
    );
  }
  if (locating) {
    return (
      <p className="py-6 text-center text-body-sm text-ink-muted">
        위치를 확인하는 중
      </p>
    );
  }

  return (
    <>
      {unfilteredNearby && (
        <Note>위치를 확인할 수 없어 지역 기준으로 보여 드려요</Note>
      )}
      {cards.length === 0 && (
        <p className="py-6 text-center text-body-sm text-ink-muted">
          가까운 곳에서 찾지 못했어요
        </p>
      )}
      <ol aria-label="추천 장소" className="flex flex-col gap-3">
        {cards.map((card, index) => (
          <li key={card.place.id}>
            <PlaceCard
              card={card}
              rank={index + 1}
              selected={card.place.id === selectedId}
              here={here}
              onPress={() => onCardPress(card)}
            />
          </li>
        ))}
      </ol>
      {hasNextPage &&
        (loadMoreFailed ? (
          <div className="flex items-center justify-between gap-2">
            <p role="alert" className="text-body-sm text-danger">
              다음 장소를 불러오지 못했어요
            </p>
            <TextButton onClick={onLoadMore}>다시 불러오기</TextButton>
          </div>
        ) : (
          // 페이지마다 새로 걸어, 붙인 뒤에도 끝이 보이면 바로 다음 페이지를 부른다
          <LoadMore key={cards.length} onVisible={onLoadMore} />
        ))}
    </>
  );
}

// 목록 끝이 보이면 다음 페이지를 부른다. 관찰은 한 번만 건다
function LoadMore({ onVisible }: { onVisible: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const handleVisible = useEffectEvent(onVisible);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) handleVisible();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div ref={ref} aria-busy className="flex flex-col gap-3">
      <span className="sr-only">다음 장소를 불러오는 중</span>
      <PlaceCardSkeleton />
    </div>
  );
}
