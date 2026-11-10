"use client";

import {
  useEffect,
  useEffectEvent,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";

import { TextButton } from "@/shared/ui/button/text-button";
import { EmptyState } from "@/shared/ui/display/empty-state";
import { Note } from "@/shared/ui/display/note";
import { Tag } from "@/shared/ui/display/tag";
import { ChevronDownIcon } from "@/shared/ui/icon/icons/chevron-down";
import { ChevronUpIcon } from "@/shared/ui/icon/icons/chevron-up";
import { FilterIcon } from "@/shared/ui/icon/icons/filter";
import { PinOffIcon } from "@/shared/ui/icon/icons/pin-off";
import { PlusIcon } from "@/shared/ui/icon/icons/plus";
import { RequestHistoryIcon } from "@/shared/ui/icon/icons/request-history";
import { SparkleIcon } from "@/shared/ui/icon/icons/sparkle";

import { showsAiFallback } from "../api/place-api";
import type {
  LatLng,
  PlaceCard as PlaceCardData,
  PlaceSearchResponse,
} from "../model/place-types";
import type { EntryKind } from "../model/search-store";
import { MapPanel, type PanelState } from "./map-panel";
import { PlaceCard, PlaceCardSkeleton } from "./place-card";
import { SearchSteps } from "./search-steps";
import { keyboardLift } from "./use-keyboard-inset";

// BE가 AI 대신 찾은 결과에 카드가 있을 때 카드 위에 띄운다(place-ai-search AC-27).
// "이 지역에서 검색"의 대체 결과는 지도 영역 안 장소라 문구가 다르다(spec 68번)
export function AiFallbackNote({
  kind,
  className,
}: {
  kind?: EntryKind;
  className?: string;
}) {
  return (
    <Note className={className}>
      {kind === "region"
        ? "지도 안의 장소만 보여드려요. 검색 조건은 적용되지 않았어요"
        : "지금은 AI 추천을 쓸 수 없어 가게 이름·메뉴로 찾았어요"}
    </Note>
  );
}

// 추천하는 지역(5-E05)
const SUPPORTED_AREAS = "강남역·역삼역·선릉역";

// 제목과 안내는 화면 가장자리에서 20px, 카드 목록은 8px 바깥(12px)에 붙는다
const LIST_CLASS = "-mx-2 flex flex-col gap-2.5";

type ResultPanelProps = {
  // 보이는 결과의 요청 종류. AI 대체 안내 문구를 고른다
  kind?: EntryKind;
  state: PanelState;
  onStateChange: (state: PanelState) => void;
  // 지금 보이는 문장. 검색 중이면 보낸 문장, 아니면 지금 보는 요청의 문장
  sentence: string;
  // 첫 페이지를 받는 중(5-03)
  searching: boolean;
  // 검색이 3초 넘게 걸릴 때 보이는 "검색 취소"(5-E02)
  onCancelSearch: () => void;
  // 검색이 실패했을 때 결과 목록 대신 보인다(5-E03, 5-E04)
  failure?: ReactNode;
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
  // 패널 아래 고정되는 후속 입력창
  footer: ReactNode;
  // 패널 위쪽 가장자리에 붙는 지도 버튼("내 위치")
  edge?: ReactNode;
};

// 지도 위에 늘 떠 있는 결과 패널. 중간(5-04)과 전체(5-05) 두 상태다. 모달이 아니라 BottomSheet를 쓰지 않는다
export function ResultPanel({
  kind,
  state,
  onStateChange,
  sentence,
  searching,
  onCancelSearch,
  failure,
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
  footer,
  edge,
}: ResultPanelProps) {
  // 받은 결과를 보여 주는 중. 검색 중이거나 실패했으면 이전 결과의 요약과 칩을 숨긴다
  const showingResults = !searching && !failure;
  const historyOpen = state === "history";

  return (
    <MapPanel
      state={state}
      label="추천 결과"
      edge={edge}
      onStateChange={onStateChange}
      footer={
        // 화면 키보드가 열리면 입력창만 키보드 위로 올라온다(FollowUpInput이 읽는다). 바닥 띠는 그대로다
        <div
          className="border-t border-line px-3 pt-2 pb-safe-2"
          style={{ "--keyboard-lift": keyboardLift(2) } as CSSProperties}
        >
          {footer}
        </div>
      }
    >
      {/* 머리글 버튼은 화면 왼쪽 8px, 오른쪽 12px에 붙는다 */}
      <div className="flex shrink-0 items-center justify-between px-4">
        <button
          type="button"
          aria-expanded={historyOpen}
          onClick={onToggleHistory}
          className="-ml-2 flex h-11 items-center gap-1 px-2 text-label-md text-ink"
        >
          {!historyOpen && (
            <RequestHistoryIcon size="md" className="text-icon" />
          )}
          요청 기록
          {historyOpen ? (
            <ChevronUpIcon size="md" className="text-icon" />
          ) : (
            <ChevronDownIcon size="md" className="text-icon" />
          )}
        </button>
        <button
          type="button"
          onClick={onNewSearch}
          className="-mr-1 flex h-11 items-center gap-1 px-2 text-label-md text-ink-muted"
        >
          <PlusIcon size="md" />새 검색
        </button>
      </div>

      {historyOpen ? (
        <div className="min-h-0 flex-1 pb-panel-4 overflow-y-auto">
          {history}
        </div>
      ) : (
        <div className="flex min-h-0 flex-1 pb-panel-4 flex-col gap-3 overflow-y-auto px-5">
          {showingResults && firstPage?.changeSummary && (
            <p
              role="status"
              className="inline-flex h-8 shrink-0 items-center gap-1.5 self-start rounded-full bg-primary-soft px-3 text-caption-md font-semibold text-primary-strong"
            >
              <SparkleIcon size="sm" />
              {firstPage.changeSummary}
            </p>
          )}
          <h2 className="text-title-sm text-ink">“{sentence}”</h2>
          {showingResults && chips.length > 0 && (
            // 제목 아래 8px(5-06)
            <div className="-mt-1 flex flex-wrap gap-1">
              {chips.map((chip, index) => (
                <Tag key={index}>추가 조건 · {chip}</Tag>
              ))}
            </div>
          )}
          {failure || (
            <PanelResults
              kind={kind}
              searching={searching}
              onCancelSearch={onCancelSearch}
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
          )}
        </div>
      )}
    </MapPanel>
  );
}

// 결과 목록. 과거 결과 화면도 다음 페이지 없이 같은 목록을 쓴다
export function PanelResults({
  kind,
  searching,
  onCancelSearch,
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
}: Partial<Pick<ResultPanelProps, "onCancelSearch">> &
  Pick<
    ResultPanelProps,
    | "kind"
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
      // 단계 문구는 제목 아래 6px, 빈 카드는 그 아래 16px(5-03)
      <div aria-busy className="-mt-1.5 flex flex-col gap-4">
        <SearchSteps onCancel={onCancelSearch} />
        <div className={LIST_CLASS}>
          <PlaceCardSkeleton />
          <PlaceCardSkeleton />
        </div>
      </div>
    );
  }
  if (!firstPage) return null;
  if (firstPage.emptyReason) {
    return (
      // 조건이 좁아 결과가 없으면 버튼 없이 안내만, 제목 아래 남은 자리 가운데에 둔다(5-E06, D-99).
      // 아래로는 목록 여백(pb-4)까지 쓰고, 안내 위 여백 28px 중 20px을 빼 위아래 8px로 맞춘다
      <div className="-mb-4 flex flex-1 flex-col justify-center">
        <EmptyState
          icon={<FilterIcon />}
          title={firstPage.emptyReason.cause}
          description={firstPage.emptyReason.suggestion}
          className="-mt-5"
        />
      </div>
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
      {showsAiFallback(firstPage) && <AiFallbackNote kind={kind} />}
      {unfilteredNearby && (
        <Note>위치를 확인할 수 없어 지역 기준으로 보여 드려요</Note>
      )}
      {cards.length === 0 && (
        // 근처 필터로 다 걸러졌거나 비어 있으면 지원 지역 밖일 수 있다(5-E05)
        <EmptyState
          icon={<PinOffIcon />}
          title="추천 장소가 없어요"
          description={
            <>
              지원 지역이 아닐 수 있어요.
              <br />
              지금은 {SUPPORTED_AREAS} 근처만 추천해요.
            </>
          }
        />
      )}
      <ol aria-label="추천 장소" className={LIST_CLASS}>
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
    <div ref={ref} aria-busy className={LIST_CLASS}>
      <span className="sr-only">다음 장소를 불러오는 중</span>
      <PlaceCardSkeleton />
    </div>
  );
}
