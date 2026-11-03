"use client";

import type { ReactNode } from "react";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button/button";
import { Fab } from "@/shared/ui/button/fab";
import { IconButton } from "@/shared/ui/button/icon-button";
import { EmptyState } from "@/shared/ui/display/empty-state";
import { Tag } from "@/shared/ui/display/tag";
import { BookmarkIcon } from "@/shared/ui/icon/icons/bookmark";
import { ChevronLeftIcon } from "@/shared/ui/icon/icons/chevron-left";
import { MapIcon } from "@/shared/ui/icon/icons/map";
import { RefreshIcon } from "@/shared/ui/icon/icons/refresh";
import { WarningIcon } from "@/shared/ui/icon/icons/warning";
import { WifiOffIcon } from "@/shared/ui/icon/icons/wifi-off";
import { TopBar } from "@/shared/ui/layout/top-bar";

import {
  CATEGORY_TABS,
  emptyCategoryText,
  type BookmarkItem,
} from "../model/bookmark";
import { distanceMeters, formatDistance } from "../model/nearby";
import { CATEGORY_LABELS, OPEN_STATUS_LABELS } from "../model/place-labels";
import type { CategoryGroup, LatLng } from "../model/place-types";
import { MapPanel } from "./map-panel";
import { PlacePhoto, statusVariants } from "./place-parts";
import { PanelHandle } from "./result-panel";
import type { SavedPanelState } from "./saved-view-state";

// 패널에 보일 것. failed는 서버 오류·시간 초과·401이 아닌 4xx, offline은 연결 실패다(D-14)
export type SavedContent =
  | { kind: "loading" }
  | { kind: "titleOnly" }
  | { kind: "failed" }
  | { kind: "offline" }
  | { kind: "loaded"; items: BookmarkItem[] };

const TITLE = "저장한 장소";

export function savedCardElementId(placeId: number) {
  return `saved-card-${placeId}`;
}

type SavedPlacesViewProps = {
  content: SavedContent;
  category?: CategoryGroup;
  onCategoryChange: (category?: CategoryGroup) => void;
  selectedId?: number;
  here?: LatLng;
  panel: SavedPanelState;
  onPanelChange: (panel: SavedPanelState) => void;
  onBack: () => void;
  onRetry: () => void;
  onOpen: (placeId: number) => void;
  onRecommend: () => void;
  // 패널 위쪽 가장자리에 붙는 지도 버튼("내 위치")
  edge?: ReactNode;
};

// 저장한 장소 화면(와이어프레임 Saved, SavedFull, SavedEmpty, SavedError, SavedNetError, D-12, D-14).
// 지도는 메인 화면의 것을 그대로 쓰고, 그 위의 [뒤로]와 하단 패널만 그린다
export function SavedPlacesView({
  content,
  category,
  onCategoryChange,
  selectedId,
  here,
  panel,
  onPanelChange,
  onBack,
  onRetry,
  onOpen,
  onRecommend,
  edge,
}: SavedPlacesViewProps) {
  // 연결이 없으면 지도 없이 전체 페이지로 안내한다(SavedNetError)
  if (content.kind === "offline") {
    return (
      <section
        aria-label={TITLE}
        className="absolute inset-0 flex flex-col bg-surface-warm pt-safe-0"
      >
        <TopBar
          start={
            <IconButton label="뒤로" onClick={onBack}>
              <ChevronLeftIcon />
            </IconButton>
          }
          title={TITLE}
        />
        <EmptyState
          role="alert"
          icon={<WifiOffIcon />}
          title="인터넷에 연결되어 있지 않아요"
          description="연결을 확인하고 다시 시도해 주세요."
          action={<RetryButton onRetry={onRetry} />}
          className="mt-40"
        />
      </section>
    );
  }

  const full = panel === "full";
  const items = content.kind === "loaded" ? content.items : [];
  const visible = category
    ? items.filter(({ place }) => place.categoryGroup === category)
    : items;
  const showList = content.kind === "loaded" && items.length > 0;

  return (
    <>
      {!full && (
        <Fab
          label="뒤로"
          onClick={onBack}
          className="absolute top-safe-4 left-4"
        >
          <ChevronLeftIcon className="text-icon" />
        </Fab>
      )}
      <MapPanel state={panel} label={TITLE} edge={edge}>
        <PanelHandle expanded={full} onChange={onPanelChange} />

        <div className="flex shrink-0 items-center gap-1 px-4 pb-2">
          {full && (
            <IconButton label="뒤로" onClick={onBack} className="-ml-3">
              <ChevronLeftIcon />
            </IconButton>
          )}
          <h1 className="text-title-md text-ink">
            {TITLE}
            {showList && (
              <span className="ml-1.5 font-normal text-ink-muted">
                {visible.length}
              </span>
            )}
          </h1>
        </div>

        {showList && (
          <div
            role="tablist"
            aria-label="업종"
            className="flex shrink-0 gap-1.5 overflow-x-auto px-4 pb-1"
          >
            {[undefined, ...CATEGORY_TABS].map((tab) => {
              const selected = tab === category;
              return (
                <button
                  key={tab ?? "ALL"}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => onCategoryChange(tab)}
                  className={cn(
                    "flex h-9 shrink-0 items-center rounded-full px-3.5 text-body-sm",
                    selected
                      ? "bg-secondary font-semibold text-on-secondary"
                      : "border border-line-strong bg-surface text-ink",
                  )}
                >
                  {tab ? CATEGORY_LABELS[tab] : "전체"}
                </button>
              );
            })}
          </div>
        )}

        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pb-safe-4">
          {content.kind === "loading" && <SavedSkeleton />}
          {content.kind === "failed" && (
            <EmptyState
              role="alert"
              icon={<WarningIcon />}
              title="저장한 장소를 불러오지 못했어요"
              description="잠시 후 다시 시도해 주세요."
              action={<RetryButton onRetry={onRetry} />}
            />
          )}
          {content.kind === "loaded" && items.length === 0 && (
            <EmptyState
              role="status"
              icon={<BookmarkIcon />}
              title="아직 저장한 장소가 없어요"
              description="장소 상세에서 저장 버튼을 누르면 여기에 모여요."
              action={
                <Button variant="outline" size="md" onClick={onRecommend}>
                  추천 받으러 가기
                </Button>
              }
            />
          )}
          {showList &&
            (visible.length === 0 && category ? (
              <p className="py-10 text-center text-body-md text-ink-muted">
                {emptyCategoryText(category)}
              </p>
            ) : (
              <ul aria-label={TITLE} className="flex flex-col">
                {visible.map((item) => (
                  <li key={item.place.id}>
                    <SavedCard
                      item={item}
                      here={here}
                      selected={item.place.id === selectedId}
                      onOpen={() => onOpen(item.place.id)}
                    />
                  </li>
                ))}
              </ul>
            ))}
        </div>

        {full && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => onPanelChange("middle")}
            className="absolute bottom-safe-6 left-1/2 -translate-x-1/2"
          >
            <MapIcon size="sm" className="mr-1" />
            지도 보기
          </Button>
        )}
      </MapPanel>
    </>
  );
}

function RetryButton({ onRetry }: { onRetry: () => void }) {
  return (
    <Button variant="outline" size="md" onClick={onRetry}>
      <RefreshIcon size="sm" className="mr-1" />
      다시 시도
    </Button>
  );
}

function SavedSkeleton() {
  return (
    <div aria-busy className="flex flex-col">
      <span className="sr-only">저장한 장소를 불러오는 중</span>
      {[0, 1, 2].map((index) => (
        <div key={index} className="flex gap-3 border-b border-line py-3.5">
          <div className="size-18 shrink-0 skeleton rounded-md" />
          <div className="flex flex-1 flex-col gap-2 pt-1">
            <div className="h-5 w-2/3 skeleton rounded-xs" />
            <div className="h-4 w-1/2 skeleton rounded-xs" />
          </div>
        </div>
      ))}
    </div>
  );
}

// "영업 중 · 350m · 역삼로12길 34". 모르는 값은 그 구분자와 함께 뺀다(AC-22)
function SavedCard({
  item,
  here,
  selected,
  onOpen,
}: {
  item: BookmarkItem;
  here?: LatLng;
  selected: boolean;
  onOpen: () => void;
}) {
  const { place, address, tags, openStatus } = item;
  const statusLabel = OPEN_STATUS_LABELS[openStatus];
  const parts: ReactNode[] = [];
  if (statusLabel) {
    parts.push(
      <span
        key="status"
        className={cn("font-semibold", statusVariants({ status: openStatus }))}
      >
        {statusLabel}
      </span>,
    );
  }
  if (here) parts.push(formatDistance(distanceMeters(here, place)));
  if (address) parts.push(address);

  return (
    <button
      type="button"
      id={savedCardElementId(place.id)}
      onClick={onOpen}
      className={cn(
        "flex w-full scroll-my-4 gap-3 border-b border-line py-3.5 text-left",
        selected && "bg-primary-soft",
      )}
    >
      <PlacePhoto
        src={place.thumbnailUrl}
        className="size-18 shrink-0 rounded-md"
      />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline gap-1.5">
          <span className="truncate text-title-md text-ink">{place.name}</span>
          <span className="shrink-0 text-caption-md text-ink-muted">
            {CATEGORY_LABELS[place.categoryGroup]}
          </span>
        </div>
        {parts.length > 0 && (
          <p className="truncate text-caption-md text-ink-muted">
            {parts.map((part, index) => (
              <span key={index}>
                {index > 0 && " · "}
                {part}
              </span>
            ))}
          </p>
        )}
        {tags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {tags.slice(0, 2).map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </div>
        )}
      </div>
    </button>
  );
}
