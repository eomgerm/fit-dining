"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { Button } from "@/shared/ui/button/button";
import { Fab } from "@/shared/ui/button/fab";
import { MyLocationIcon } from "@/shared/ui/icon/icons/my-location";
import { RefreshIcon } from "@/shared/ui/icon/icons/refresh";
import { useToast } from "@/shared/ui/overlay/toast";

import { placeQueries } from "../api/place-queries";
import type { PlaceCard, PlaceSearchRequest } from "../model/place-types";
import {
  followUpRequest,
  newSearchRequest,
  regionRequest,
  shouldSendMapBounds,
} from "../model/search-request";
import {
  followUpChips,
  nextEntryId,
  searchStore,
  type EntryKind,
} from "../model/search-store";
import { FollowUpInput } from "./follow-up-input";
import { HistorySheet } from "./history-sheet";
import { LOCATION_FAILED_MESSAGE, locateDevice } from "./locate-device";
import { placeCardElementId } from "./place-card";
import { PlaceMap, type PlaceMapHandle } from "./place-map";
import { ResultPanel, type PanelState } from "./result-panel";
import { SearchBar } from "./search-bar";
import { useHere, useSearchStore } from "./use-search-store";
import { useViewingResults } from "./use-viewing-results";

type SearchInput = {
  kind: EntryKind;
  baseId?: string;
  request: PlaceSearchRequest;
};

const ERROR_MESSAGE = "결과를 불러오지 못했어요. 잠시 뒤 다시 시도해 주세요";

// 검색·추천 결과 화면(5-01, 5-03~5-07)
export function SearchScreen() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const toast = useToast();
  const { entries, selectedPlaceId } = useSearchStore();
  const results = useViewingResults();
  const { viewing } = results;
  const here = useHere();

  const mapRef = useRef<PlaceMapHandle>(null);
  const followUpRef = useRef<HTMLInputElement>(null);
  const focusFollowUp = useRef(false);
  const [mapReady, setMapReady] = useState(false);
  const [panel, setPanel] = useState<PanelState>("middle");
  const [historyOpen, setHistoryOpen] = useState(false);
  // 사용자가 지도를 움직였는지. "이 지역에서 검색" 버튼은 그 뒤에만 보이고, 보는 결과가 바뀌면 숨는다
  const [mapMoved, setMapMoved] = useState(false);
  // 검색 중에 "새 검색"이나 "결과 보기"를 누르면 올린다. 그 전에 보낸 요청의 결과는 버린다
  const searchGeneration = useRef(0);

  // 첫 페이지를 받은 뒤에만 기록에 넣고 화면을 바꾼다. 실패한 요청은 쌓지 않는다
  const search = useMutation({
    mutationFn: async ({ kind, baseId, request }: SearchInput) => {
      const generation = searchGeneration.current;
      const id = nextEntryId();
      const options = placeQueries.search(id, request);
      try {
        const data = await queryClient.fetchInfiniteQuery(options);
        if (generation !== searchGeneration.current) {
          queryClient.removeQueries({
            queryKey: options.queryKey,
            exact: true,
          });
          return;
        }
        searchStore.addEntry({
          id,
          kind,
          baseId,
          request,
          response: data.pages[0],
        });
      } catch (error) {
        queryClient.removeQueries({ queryKey: options.queryKey, exact: true });
        throw error;
      }
    },
  });

  function run(input: SearchInput) {
    setPanel("middle");
    setMapMoved(false);
    search.mutate(input);
  }

  // 지역을 고정했거나 위치를 얻지 못한 것이 확인됐을 때만 지도 영역을 담는다
  function firstPageBounds() {
    return shouldSendMapBounds(searchStore.getSnapshot())
      ? mapRef.current?.getBounds()
      : undefined;
  }

  function handleNewSearch(input: string) {
    run({ kind: "new", request: newSearchRequest(input, firstPageBounds()) });
  }

  function handleFollowUp(input: string) {
    if (!viewing) return;
    run({
      kind: "followUp",
      baseId: viewing.id,
      request: followUpRequest(input, viewing, firstPageBounds()),
    });
  }

  function handleRegionSearch() {
    const bounds = mapRef.current?.getBounds();
    if (!viewing || !bounds) return;
    searchStore.lockRegion();
    run({
      kind: "region",
      baseId: viewing.id,
      request: regionRequest(viewing.request, bounds),
    });
  }

  // 진행 중인 검색을 버리고 그 결과가 화면을 바꾸지 않게 한다
  function abandonSearch() {
    searchGeneration.current += 1;
    search.reset();
    setMapMoved(false);
  }

  function handleStartOver() {
    abandonSearch();
    searchStore.startNewSearch();
  }

  function handleView(entryId: string) {
    abandonSearch();
    searchStore.view(entryId);
    setHistoryOpen(false);
  }

  function handleContinue(entryId: string) {
    focusFollowUp.current = true;
    handleView(entryId);
  }

  // 처음 누르면 지도를 그 핀으로 옮기고 선택한다. 선택된 카드를 다시 누르면 상세로 간다
  function handleCardPress({ place }: PlaceCard) {
    if (place.id === selectedPlaceId) {
      router.push(`/place?id=${place.id}`);
      return;
    }
    mapRef.current?.panTo(place);
    searchStore.select(place.id);
  }

  function handlePinClick(placeId: number) {
    searchStore.select(placeId);
    document
      .getElementById(placeCardElementId(placeId))
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  async function handleMyLocation() {
    const found = await locateDevice();
    if (found) mapRef.current?.panTo(found);
    else toast(LOCATION_FAILED_MESSAGE);
  }

  const searching = search.isPending;
  const showPanel = Boolean(viewing) || searching;
  const errorLine = search.isError && (
    <p role="alert" className="text-body-sm text-danger">
      {ERROR_MESSAGE}
    </p>
  );
  const myLocationButton = mapReady && (
    <Fab label="내 위치" onClick={handleMyLocation}>
      <MyLocationIcon className="text-icon" />
    </Fab>
  );

  return (
    <main className="relative h-dvh overflow-hidden">
      <PlaceMap
        ref={mapRef}
        // 패널이 있으면 지도를 패널 위쪽에 맞춰 지도 중심과 핀이 가려지지 않게 한다(조금 겹친다)
        className={
          showPanel ? "absolute inset-x-0 top-0 h-1/2" : "absolute inset-0"
        }
        pins={results.cards.map(({ place }, index) => ({
          id: place.id,
          rank: index + 1,
          lat: place.lat,
          lng: place.lng,
        }))}
        selectedId={selectedPlaceId}
        myLocation={here}
        onPinClick={handlePinClick}
        onUserMove={() => setMapMoved(true)}
        onReadyChange={setMapReady}
      />

      {mapReady && mapMoved && viewing && !searching && panel === "middle" && (
        <Button
          variant="outline"
          size="sm"
          onClick={handleRegionSearch}
          className="absolute top-4 left-1/2 -translate-x-1/2"
        >
          <RefreshIcon size="sm" className="mr-1" />이 지역에서 검색
        </Button>
      )}

      {showPanel ? (
        <ResultPanel
          state={panel}
          onStateChange={setPanel}
          sentence={
            searching
              ? (search.variables?.request.query ?? "")
              : (viewing?.sentence ?? "")
          }
          searching={searching}
          firstPage={results.firstPage}
          chips={followUpChips(entries, viewing?.id)}
          cards={results.cards}
          selectedId={selectedPlaceId}
          here={here}
          locating={results.locating}
          unfilteredNearby={results.unfilteredNearby}
          hasNextPage={results.hasNextPage}
          onLoadMore={results.loadMore}
          loadMoreFailed={results.loadMoreFailed}
          onCardPress={handleCardPress}
          onNewSearch={handleStartOver}
          onOpenHistory={() => setHistoryOpen(true)}
          message={errorLine}
          edge={myLocationButton}
          footer={
            <FollowUpInput
              inputRef={followUpRef}
              onSubmit={handleFollowUp}
              onOpenHistory={() => setHistoryOpen(true)}
              disabled={searching}
            />
          }
        />
      ) : (
        <>
          <div className="absolute inset-x-0 top-0 p-4">
            <SearchBar
              onSearch={handleNewSearch}
              onOpenHistory={
                entries.length > 0 ? () => setHistoryOpen(true) : undefined
              }
              message={errorLine}
            />
          </div>
          {myLocationButton && (
            <div className="absolute right-4 bottom-8">{myLocationButton}</div>
          )}
        </>
      )}

      <HistorySheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        onOpenChangeComplete={(open) => {
          if (open || !focusFollowUp.current) return;
          focusFollowUp.current = false;
          followUpRef.current?.focus();
        }}
        onView={handleView}
        onContinue={handleContinue}
      />
    </main>
  );
}
