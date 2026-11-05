"use client";

import { useState, type ReactNode } from "react";

import { Button } from "@/shared/ui/button/button";
import { ChevronLeftIcon } from "@/shared/ui/icon/icons/chevron-left";
import { ClockIcon } from "@/shared/ui/icon/icons/clock";
import { RefreshIcon } from "@/shared/ui/icon/icons/refresh";

import type {
  LatLng,
  PlaceCard,
  PlaceSearchResponse,
} from "../model/place-types";
import type { HistoryEntry } from "../model/search-store";
import { formatRecentAt } from "../model/search-threads";
import { MapPanel } from "./map-panel";
import { PanelResults } from "./result-panel";

type PastResultViewProps = {
  past: HistoryEntry;
  firstPage?: PlaceSearchResponse;
  cards: PlaceCard[];
  selectedId?: number;
  here?: LatLng;
  locating: boolean;
  unfilteredNearby: boolean;
  onCardPress: (card: PlaceCard) => void;
  // "현재 검색으로". 요청 기록을 펼친 결과 패널로 돌아간다
  onBack: () => void;
  // "이 조건으로 다시 검색". 같은 요청 본문을 다시 보내 지금 thread 끝에 쌓는다
  onRepeat: () => void;
  // 패널 위쪽 가장자리에 붙는 지도 버튼("내 위치")
  edge?: ReactNode;
};

// 과거 결과 화면(와이어프레임 PastResult). 그때 받은 결과를 다시 받지 않고 그대로 보인다
export function PastResultView({
  past,
  firstPage,
  cards,
  selectedId,
  here,
  locating,
  unfilteredNearby,
  onCardPress,
  onBack,
  onRepeat,
  edge,
}: PastResultViewProps) {
  // "오늘"을 가르는 기준 시각. 화면을 열 때 잡는다
  const [now] = useState(() => Date.now());

  return (
    <>
      <button
        type="button"
        onClick={onBack}
        className="absolute top-safe-4 left-4 flex h-11 items-center gap-1 rounded-full bg-surface pr-4 pl-2.5 text-label-md text-ink shadow-2"
      >
        <ChevronLeftIcon size="md" />
        현재 검색으로
      </button>

      <MapPanel
        state="middle"
        label="과거 결과"
        edge={edge}
        footer={
          <div className="border-t border-line px-4 pt-3 pb-safe-4">
            <Button onClick={onRepeat} className="w-full">
              <RefreshIcon size="md" className="mr-1.5" />이 조건으로 다시 검색
            </Button>
          </div>
        }
      >
        <p className="flex shrink-0 items-center gap-1.5 px-4 pb-3 text-caption-md text-ink-muted">
          <ClockIcon size="sm" />
          <span className="truncate">
            {formatRecentAt(past.at, now)} 결과 · “{past.sentence}”
          </span>
        </p>
        <div className="flex min-h-0 flex-1 pb-panel-4 flex-col gap-3 overflow-y-auto px-5">
          <PanelResults
            searching={false}
            firstPage={firstPage}
            cards={cards}
            selectedId={selectedId}
            here={here}
            locating={locating}
            unfilteredNearby={unfilteredNearby}
            hasNextPage={false}
            onLoadMore={() => {}}
            loadMoreFailed={false}
            onCardPress={onCardPress}
          />
        </div>
      </MapPanel>
    </>
  );
}
