"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type ReactNode } from "react";

import { isApiError } from "@/shared/api/api-error";
import { Fab } from "@/shared/ui/button/fab";
import { Carousel } from "@/shared/ui/display/carousel";
import { CarouselDots } from "@/shared/ui/display/carousel-dots";
import { EmptyState } from "@/shared/ui/display/empty-state";
import { Tag } from "@/shared/ui/display/tag";
import { ChevronLeftIcon } from "@/shared/ui/icon/icons/chevron-left";
import { InfoIcon } from "@/shared/ui/icon/icons/info";
import { PinOffIcon } from "@/shared/ui/icon/icons/pin-off";
import { ShareIcon } from "@/shared/ui/icon/icons/share";
import { BottomBar } from "@/shared/ui/layout/bottom-bar";
import { Tab, TabList, TabPanel, Tabs } from "@/shared/ui/layout/tabs";
import { useToast } from "@/shared/ui/overlay/toast";
import { Tooltip } from "@/shared/ui/overlay/tooltip";

import { placeQueries } from "../api/place-queries";
import {
  placeDetailHref,
  SAVED_VIEW,
  type BookmarkAccess,
} from "../model/bookmark";
import { todayNotice } from "../model/opening-hours";
import { parsePlaceId } from "../model/place-id";
import type { PlaceCard, PlaceDetail } from "../model/place-types";
import { BookmarkButton } from "./bookmark-button";
import { LoadFailed } from "./load-failed";
import { HomeTab, InfoTab, MenuTab } from "./place-detail-tabs";
import {
  OpenStatusText,
  PhotoPlaceholder,
  PlaceMeta,
  PlacePhoto,
} from "./place-parts";
import { useHere } from "./use-search-store";
import { useStoredCard } from "./use-stored-card";

type DetailTab = "home" | "menu" | "review" | "info";

const NOT_READY_MESSAGE = "준비 중이에요";
// 핏 점수 (i) 말풍선(6-05)
const SCORE_HELP =
  "이번 요청과 내 취향에 얼마나 맞는지 0~100으로 나타낸 점수예요. 만족할 확률은 아니에요.";

// 리뷰가 들어갈 자리. 도메인끼리는 import하지 않으므로 app이 리뷰 도메인으로 채운다(리뷰 D-32)
export type PlaceDetailSlots = {
  // 홈 탭 맨 아래. showReviews는 리뷰 탭으로 바꾼다
  homeReviews?: (placeId: number, showReviews: () => void) => ReactNode;
  // 리뷰 탭 내용. 있을 때만 리뷰 탭이 생긴다
  reviewTab?: (placeId: number) => ReactNode;
  // 하단 막대에서 저장 버튼 옆의 버튼("방문 평가 남기기")
  bottomAction?: (placeId: number) => ReactNode;
};

// 장소 상세(6-01, 6-02, 6-04, 6-05, 와이어프레임 Detail·DetailMenu·DetailInfo·DetailSaved). ?id가 올바른 정수일 때만 요청한다.
// bookmarks는 저장 버튼의 인증이다. 인증 도메인을 쓰는 app이 넘긴다
export function PlaceDetailScreen({
  slots,
  bookmarks,
}: {
  slots?: PlaceDetailSlots;
  bookmarks: BookmarkAccess;
}) {
  const params = useSearchParams();
  const id = parsePlaceId(params.get("id"));
  // 저장한 장소 화면에서 열었으면 핏 점수와 추천 이유를 보이지 않는다(D-12)
  const fromSaved = params.get("from") === SAVED_VIEW;
  return (
    <main className="relative flex min-h-dvh flex-col bg-surface-warm">
      {id === undefined ? (
        <>
          <BackBar />
          <NotFound />
        </>
      ) : (
        <PlaceDetailContent
          id={id}
          slots={slots}
          bookmarks={bookmarks}
          fromSaved={fromSaved}
        />
      )}
    </main>
  );
}

// 사진이 없는 상태(찾을 수 없음, 불러오는 중, 오류)의 뒤로 버튼 줄
function BackBar() {
  return (
    <div className="flex h-19 shrink-0 items-center px-4">
      <BackButton />
    </div>
  );
}

function BackButton() {
  const router = useRouter();
  return (
    <Fab label="뒤로" onClick={() => router.back()}>
      <ChevronLeftIcon className="text-icon" />
    </Fab>
  );
}

function NotFound() {
  return (
    <EmptyState
      icon={<PinOffIcon />}
      title="장소를 찾을 수 없어요"
      description="주소가 맞는지 확인해 주세요"
    />
  );
}

function PlaceDetailContent({
  id,
  slots,
  bookmarks,
  fromSaved,
}: {
  id: number;
  slots?: PlaceDetailSlots;
  bookmarks: BookmarkAccess;
  fromSaved: boolean;
}) {
  const query = useQuery(placeQueries.detail(id));
  const storedCard = useStoredCard(id);
  const card = fromSaved ? undefined : storedCard;

  if (query.isPending) {
    return (
      <>
        <BackBar />
        <div aria-busy className="flex flex-col gap-3 p-4">
          <span className="sr-only">장소 정보를 불러오는 중</span>
          <div className="h-60 w-full skeleton rounded-md" />
          <div className="h-6 w-1/2 skeleton rounded-xs" />
          <div className="h-4 w-1/3 skeleton rounded-xs" />
        </div>
      </>
    );
  }
  if (query.isError) {
    const notFound = isApiError(query.error) && query.error.status === 404;
    return (
      <>
        <BackBar />
        {notFound ? (
          <NotFound />
        ) : (
          <LoadFailed
            error={query.error}
            title="장소 정보를 불러오지 못했어요"
            onRetry={() => query.refetch()}
            className="mt-40"
          />
        )}
      </>
    );
  }
  return (
    <PlaceDetailView
      detail={query.data}
      card={card}
      slots={slots}
      bookmarks={bookmarks}
      returnTo={placeDetailHref(id, fromSaved)}
    />
  );
}

function PlaceDetailView({
  detail,
  card,
  slots,
  bookmarks,
  returnTo,
}: {
  detail: PlaceDetail;
  card?: PlaceCard;
  slots?: PlaceDetailSlots;
  bookmarks: BookmarkAccess;
  returnTo: string;
}) {
  const here = useHere();
  const toast = useToast();
  const [now] = useState(() => new Date());
  const [tab, setTab] = useState<DetailTab>("home");
  const [photoIndex, setPhotoIndex] = useState(0);
  const { place } = detail;

  return (
    <>
      {/* 사진이 화면 폭 가득 크게 보이고 아래쪽은 바탕색으로 흐려진다 */}
      <div className="relative">
        {detail.photos.length > 0 ? (
          <Carousel
            label="장소 사진"
            slideClassName="basis-full"
            onIndexChange={setPhotoIndex}
          >
            {detail.photos.map((photo) => (
              <PlacePhoto key={photo} src={photo} className="h-108 w-full" />
            ))}
          </Carousel>
        ) : (
          <PhotoPlaceholder className="h-108 w-full" />
        )}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-64 bg-linear-to-b from-surface-warm/0 via-surface-warm/60 to-surface-warm"
        />
        {detail.photos.length > 1 && (
          <CarouselDots
            count={detail.photos.length}
            index={photoIndex}
            className="absolute top-72 left-1/2 -translate-x-1/2"
          />
        )}
        <div className="absolute inset-x-4 top-4 flex justify-between">
          <BackButton />
          <Fab label="공유" onClick={() => toast(NOT_READY_MESSAGE)}>
            <ShareIcon className="text-icon" />
          </Fab>
        </div>
      </div>

      <section className="relative -mt-28 flex flex-col gap-1 px-5">
        <PlaceMeta place={place} here={here} />
        <div className="flex items-end justify-between gap-3">
          <h1 className="text-headline-lg text-ink">{place.name}</h1>
          {card?.score !== undefined && (
            <Tooltip label="핏 점수 설명" content={SCORE_HELP}>
              <button
                type="button"
                aria-label={`핏 점수 ${card.score}, 설명 보기`}
                className="flex min-h-11 shrink-0 flex-col items-end"
              >
                <span className="text-headline-md text-primary-strong">
                  {card.score}
                </span>
                <span className="flex items-center gap-0.5 text-caption-sm text-ink-muted">
                  핏 점수
                  <InfoIcon size="sm" />
                </span>
              </button>
            </Tooltip>
          )}
        </div>
        <OpenStatusText
          status={detail.openStatus}
          notice={todayNotice(detail.hours, detail.openStatus, now)}
        />
        {detail.tags.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {detail.tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </div>
        )}
      </section>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as DetailTab)}
        className="mt-5 flex flex-1 flex-col"
      >
        {/* 탭은 사진이 지나간 뒤 화면 위쪽에 붙는다 */}
        <div className="sticky top-0 z-10 bg-surface-warm">
          <TabList>
            <Tab value="home" className="flex-1">
              홈
            </Tab>
            <Tab value="menu" className="flex-1">
              메뉴
            </Tab>
            {slots?.reviewTab && (
              <Tab value="review" className="flex-1">
                리뷰
              </Tab>
            )}
            <Tab value="info" className="flex-1">
              정보
            </Tab>
          </TabList>
        </div>
        <TabPanel value="home">
          <HomeTab
            detail={detail}
            card={card}
            here={here}
            now={now}
            onShowInfo={() => setTab("info")}
            onShowMenu={() => setTab("menu")}
            reviews={slots?.homeReviews?.(place.id, () => setTab("review"))}
          />
        </TabPanel>
        <TabPanel value="menu">
          <MenuTab detail={detail} here={here} />
        </TabPanel>
        {slots?.reviewTab && (
          <TabPanel value="review">{slots.reviewTab(place.id)}</TabPanel>
        )}
        <TabPanel value="info">
          <InfoTab detail={detail} here={here} now={now} />
        </TabPanel>
      </Tabs>

      <BottomBar variant="divider">
        <div className="flex gap-2.5">
          <BookmarkButton
            placeId={place.id}
            access={bookmarks}
            returnTo={returnTo}
          />
          {slots?.bottomAction && (
            <div className="min-w-0 flex-1">{slots.bottomAction(place.id)}</div>
          )}
        </div>
      </BottomBar>
    </>
  );
}
