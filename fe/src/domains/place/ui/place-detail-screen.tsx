"use client";

import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { isApiError } from "@/shared/api/api-error";
import { IconButton } from "@/shared/ui/button/icon-button";
import { Carousel } from "@/shared/ui/display/carousel";
import { EmptyState } from "@/shared/ui/display/empty-state";
import { Tag } from "@/shared/ui/display/tag";
import { ChevronLeftIcon } from "@/shared/ui/icon/icons/chevron-left";
import { InfoIcon } from "@/shared/ui/icon/icons/info";
import { PinOffIcon } from "@/shared/ui/icon/icons/pin-off";
import { Tab, TabList, TabPanel, Tabs } from "@/shared/ui/layout/tabs";
import { TopBar } from "@/shared/ui/layout/top-bar";

import { placeQueries } from "../api/place-queries";
import { todayNotice } from "../model/opening-hours";
import { parsePlaceId } from "../model/place-id";
import type { PlaceCard, PlaceDetail } from "../model/place-types";
import { FitScore } from "./fit-score";
import { HomeTab, InfoTab, MenuTab } from "./place-detail-tabs";
import {
  OpenStatusText,
  PhotoPlaceholder,
  PlaceMeta,
  PlacePhoto,
} from "./place-parts";
import { ScoreSheet } from "./score-sheet";
import { useHere } from "./use-search-store";
import { useStoredCard } from "./use-stored-card";

type DetailTab = "home" | "menu" | "info";

// 장소 상세(6-01, 6-02, 6-04, 6-05). ?id가 올바른 정수일 때만 요청한다
export function PlaceDetailScreen() {
  const id = parsePlaceId(useSearchParams().get("id"));
  return (
    <main className="flex min-h-dvh flex-col bg-surface-warm">
      <BackBar />
      {id === undefined ? <NotFound /> : <PlaceDetailContent id={id} />}
    </main>
  );
}

function BackBar() {
  const router = useRouter();
  return (
    <TopBar
      tone="surface"
      className="sticky top-0 z-10"
      start={
        <IconButton label="뒤로" onClick={() => router.back()}>
          <ChevronLeftIcon className="text-icon" />
        </IconButton>
      }
    />
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

function PlaceDetailContent({ id }: { id: number }) {
  const query = useQuery(placeQueries.detail(id));
  const card = useStoredCard(id);

  if (query.isPending) {
    return (
      <div aria-busy className="flex flex-col gap-3 p-4">
        <span className="sr-only">장소 정보를 불러오는 중</span>
        <div className="h-60 w-full skeleton rounded-md" />
        <div className="h-6 w-1/2 skeleton rounded-xs" />
        <div className="h-4 w-1/3 skeleton rounded-xs" />
      </div>
    );
  }
  if (query.isError) {
    if (isApiError(query.error) && query.error.status === 404) {
      return <NotFound />;
    }
    return (
      <p role="alert" className="p-4 text-body-sm text-danger">
        장소 정보를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요
      </p>
    );
  }
  return <PlaceDetailView detail={query.data} card={card} />;
}

function PlaceDetailView({
  detail,
  card,
}: {
  detail: PlaceDetail;
  card?: PlaceCard;
}) {
  const here = useHere();
  const [now] = useState(() => new Date());
  const [tab, setTab] = useState<DetailTab>("home");
  const [scoreOpen, setScoreOpen] = useState(false);
  const { place } = detail;

  return (
    <>
      {detail.photos.length > 0 ? (
        <Carousel label="장소 사진" slideClassName="basis-full">
          {detail.photos.map((photo) => (
            <PlacePhoto key={photo} src={photo} className="h-60 w-full" />
          ))}
        </Carousel>
      ) : (
        <PhotoPlaceholder className="h-60 w-full" />
      )}

      <section className="flex flex-col gap-2 bg-surface px-4 pt-5 pb-6">
        <PlaceMeta place={place} here={here} />
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-headline-md text-ink">{place.name}</h1>
          {card && (
            <div className="flex items-start">
              <FitScore score={card.score} />
              <IconButton
                label="핏 점수 설명"
                onClick={() => setScoreOpen(true)}
                className="-mt-2 -mr-3"
              >
                <InfoIcon size="md" className="text-ink-muted" />
              </IconButton>
            </div>
          )}
        </div>
        <OpenStatusText
          status={detail.openStatus}
          notice={todayNotice(detail.hours, detail.openStatus, now)}
        />
        {detail.tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {detail.tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
          </div>
        )}
      </section>

      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as DetailTab)}
        className="flex flex-1 flex-col"
      >
        <TabList className="sticky top-14 z-10">
          <Tab value="home">홈</Tab>
          <Tab value="menu">메뉴</Tab>
          <Tab value="info">정보</Tab>
        </TabList>
        <TabPanel value="home">
          <HomeTab
            detail={detail}
            card={card}
            here={here}
            now={now}
            onShowInfo={() => setTab("info")}
            onShowMenu={() => setTab("menu")}
          />
        </TabPanel>
        <TabPanel value="menu">
          <MenuTab detail={detail} here={here} />
        </TabPanel>
        <TabPanel value="info">
          <InfoTab detail={detail} here={here} />
        </TabPanel>
      </Tabs>

      {card && (
        <ScoreSheet card={card} open={scoreOpen} onOpenChange={setScoreOpen} />
      )}
    </>
  );
}
