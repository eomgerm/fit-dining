"use client";

import {
  useMutation,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useEffectEvent, useRef, useState } from "react";

import { Button } from "@/shared/ui/button/button";
import { Fab } from "@/shared/ui/button/fab";
import { BookmarkIcon } from "@/shared/ui/icon/icons/bookmark";
import { MyLocationIcon } from "@/shared/ui/icon/icons/my-location";
import { RefreshIcon } from "@/shared/ui/icon/icons/refresh";
import { UserIcon } from "@/shared/ui/icon/icons/user";
import { useToast } from "@/shared/ui/overlay/toast";

import { placeQueries } from "../api/place-queries";
import {
  guestAccess,
  parseCategory,
  placeDetailHref,
  SAVED_VIEW,
  savedPlacesHref,
  type BookmarkAccess,
} from "../model/bookmark";
import type {
  CategoryGroup,
  LatLng,
  PlaceCard,
  PlaceSearchRequest,
} from "../model/place-types";
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
import { appendTurn } from "../model/search-threads";
import { FollowUpInput } from "./follow-up-input";
import { HistoryTimeline } from "./history-timeline";
import { isOfflineError, LoadFailed } from "./load-failed";
import {
  LOCATION_DENIED_MESSAGE,
  LOCATION_FAILED_MESSAGE,
  locateDevice,
  locateIfGranted,
} from "./locate-device";
import { LoginPrompt, SAVED_LOGIN_MESSAGE } from "./login-prompt";
import { NearbyCarousel } from "./nearby-carousel";
import { PastResultView } from "./past-result-view";
import { placeCardElementId } from "./place-card";
import { PlaceMap, type PlaceMapHandle } from "./place-map";
import { RecentSearchSheet } from "./recent-search-sheet";
import { ResultPanel, type PanelState } from "./result-panel";
import { savedCardElementId, SavedPlacesView } from "./saved-places";
import { savedViewState, type SavedPanelState } from "./saved-view-state";
import { SearchBar } from "./search-bar";
import { getThread, saveThread } from "./thread-storage";
import { useNearbyPicks } from "./use-nearby-picks";
import { useSavedPlaces } from "./use-saved-places";
import { useHere, useSearchStore } from "./use-search-store";
import { usePastResults, useViewingResults } from "./use-viewing-results";

type SearchInput = {
  kind: EntryKind;
  baseId?: string;
  request: PlaceSearchRequest;
};

const GUEST = guestAccess(() => {});

// 첫 화면(와이어프레임 Start)과 검색·추천 결과 화면(5-01, 5-03~5-07), 저장한 장소 화면(?view=saved, 와이어프레임 Saved).
// bookmarks는 저장한 장소의 인증이다. 인증 도메인을 쓰는 app이 넘기고, 없으면 비로그인처럼 보인다
export function SearchScreen({
  bookmarks = GUEST,
}: {
  bookmarks?: BookmarkAccess;
}) {
  const router = useRouter();
  const params = useSearchParams();
  // 저장한 장소 화면은 메인의 지도와 하단 패널이 내 저장 장소만 보이도록 바뀐 상태다(D-12)
  const savedView = params.get("view") === SAVED_VIEW;
  const savedCategory = parseCategory(params.get("category"));
  const queryClient = useQueryClient();
  const toast = useToast();
  const { threadId, entries, selectedPlaceId } = useSearchStore();
  const results = useViewingResults();
  const { viewing } = results;
  const pastResults = usePastResults();
  const { past } = pastResults;
  const here = useHere();

  const mapRef = useRef<PlaceMapHandle>(null);
  const followUpRef = useRef<HTMLInputElement>(null);
  const [mapReady, setMapReady] = useState(false);
  // 상세에 다녀와 저장한 장소 화면으로 다시 그려졌으면, 들어오기 전 메인의 패널 상태로 시작한다
  const [panel, setPanel] = useState<PanelState>(() => {
    const entry = savedView ? savedViewState.entry() : undefined;
    return entry?.from === "main" ? entry.mainPanel : "middle";
  });
  // 요청 기록을 접으면 펼치기 전 상태로 돌아간다
  const panelBeforeHistory = useRef<PanelState>("middle");
  const [recentOpen, setRecentOpen] = useState(false);
  // "여기서 이어 검색" 뒤 후속 입력창에 초점을 두라는 요청. 입력창이 다시 켜진 뒤에 옮긴다
  const [focusRequest, setFocusRequest] = useState(0);
  // 사용자가 지도를 움직였는지. "이 지역에서 검색" 버튼은 그 뒤에만 보이고, 보는 결과가 바뀌면 숨는다
  const [mapMoved, setMapMoved] = useState(false);
  // 검색 중에 "새 검색"이나 다른 결과로 바꾸면 올린다. 그 전에 보낸 요청의 결과는 버린다
  const searchGeneration = useRef(0);
  // 받는 중인 첫 페이지의 쿼리 키. 검색을 버리면 그 요청을 끊는다
  const pendingKey = useRef<QueryKey | undefined>(undefined);
  // 지도를 마지막으로 옮겨 준 기기 위치. 새 위치를 얻을 때만 지도를 옮긴다
  const centeredOn = useRef<LatLng | undefined>(undefined);

  const saved = useSavedPlaces(bookmarks, savedView);
  const [savedPanel, setSavedPanel] = useState<SavedPanelState>(
    savedViewState.panel,
  );
  // 저장한 장소 화면에서 핀으로 가리킨 카드. 밑에 있는 메인 화면의 선택은 바꾸지 않는다
  const [savedSelectedId, setSavedSelectedId] = useState<number>();
  // 메인 "저장한 장소" 버튼을 비로그인 사용자가 눌렀다
  const [savedPromptFromMain, setSavedPromptFromMain] = useState(false);
  const [wasSaved, setWasSaved] = useState(savedView);
  if (wasSaved !== savedView) {
    setWasSaved(savedView);
    if (savedView) setSavedPanel(savedViewState.panel());
  }
  // 메인 화면을 보이면 저장한 장소 화면에 앱 안에서 들어왔다는 기록을 지운다
  useEffect(() => {
    if (!savedView) savedViewState.clear();
  }, [savedView]);

  // 첫 페이지를 받은 뒤에만 기록에 넣고 화면을 바꾼다. 실패한 요청은 쌓지 않는다.
  // 쌓은 요청은 그때 받은 첫 페이지와 함께 지금 thread에 저장한다
  const search = useMutation({
    mutationFn: async ({ kind, baseId, request }: SearchInput) => {
      const generation = searchGeneration.current;
      const id = nextEntryId();
      const options = placeQueries.search(id, request);
      pendingKey.current = options.queryKey;
      try {
        const data = await queryClient.fetchInfiniteQuery(options);
        if (generation !== searchGeneration.current) {
          queryClient.removeQueries({
            queryKey: options.queryKey,
            exact: true,
          });
          return;
        }
        const response = data.pages[0];
        const entry = searchStore.addEntry({
          id,
          kind,
          baseId,
          request,
          response,
        });
        const thread = searchStore.getSnapshot().threadId;
        if (thread) {
          saveThread(
            appendTurn(getThread(thread), thread, {
              id,
              kind,
              ...(baseId && { baseId }),
              at: entry.at,
              request,
              response,
            }),
          );
        }
      } catch (error) {
        queryClient.removeQueries({ queryKey: options.queryKey, exact: true });
        throw error;
      }
    },
  });

  const searching = search.isPending;
  // 실패하면 결과 패널에 실패 안내를 띄운다(5-E03, 5-E04). 첫 검색이 실패해도 패널을 연다
  const failed = search.isError;
  const showPanel = Boolean(viewing) || searching || failed;
  const firstScreen = !showPanel && !past;
  const nearby = useNearbyPicks(firstScreen && !savedView);
  const nearbyOffline = isOfflineError(nearby.error);
  // 가운데 카드가 선택된 카드다. 고른 적이 없으면 첫 카드
  const selectedNearbyId = nearby.cards.some(
    ({ place }) => place.id === selectedPlaceId,
  )
    ? selectedPlaceId
    : nearby.cards[0]?.place.id;

  // 권한이 이미 허용이면 화면을 열 때 묻지 않고 위치를 받는다
  const locateOnOpen = useEffectEvent(() => {
    locateIfGranted().then((result) => {
      if (result === "denied") toast(LOCATION_DENIED_MESSAGE);
      if (result === "failed") toast(LOCATION_FAILED_MESSAGE);
    });
  });
  useEffect(() => {
    locateOnOpen();
  }, []);

  // 위치를 얻으면(화면을 열 때, "내 위치", 근처 응답) 지도를 그 위치로 옮긴다
  useEffect(() => {
    if (!mapReady || !here || centeredOn.current === here) return;
    centeredOn.current = here;
    mapRef.current?.panTo(here);
  }, [mapReady, here]);

  useEffect(() => {
    if (focusRequest > 0 && !searching) followUpRef.current?.focus();
  }, [focusRequest, searching]);

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

  // 진행 중인 검색을 버리고 그 결과가 화면을 바꾸지 않게 한다. 받는 중인 요청도 끊는다
  function abandonSearch() {
    searchGeneration.current += 1;
    if (pendingKey.current) {
      void queryClient.cancelQueries({
        queryKey: pendingKey.current,
        exact: true,
      });
      pendingKey.current = undefined;
    }
    search.reset();
    setMapMoved(false);
  }

  // 실패한 요청을 같은 종류와 기준 요청으로 다시 보낸다
  function handleRetrySearch() {
    if (search.variables) run(search.variables);
  }

  // 지금 thread를 닫는다. 다음 새 검색이 새 thread를 연다
  function handleStartOver() {
    abandonSearch();
    searchStore.startNewSearch();
    setPanel("middle");
  }

  function handleToggleHistory() {
    if (panel === "history") {
      setPanel(panelBeforeHistory.current);
      return;
    }
    panelBeforeHistory.current = panel;
    setPanel("history");
  }

  // "결과 보기". 지금 보는 요청은 그대로 두고 그때 결과의 과거 결과 화면을 연다
  function handleView(entryId: string) {
    abandonSearch();
    searchStore.openPast(entryId);
  }

  function handleContinue(entryId: string) {
    abandonSearch();
    searchStore.view(entryId);
    setPanel(panelBeforeHistory.current);
    setFocusRequest((count) => count + 1);
  }

  function handleBackFromPast() {
    searchStore.closePast();
    setPanel("history");
  }

  // 그 요청 본문을 그대로 같은 종류와 기준 요청으로 다시 보낸다. 지금 thread 끝에 쌓인다
  function handleRepeatPast() {
    if (!past) return;
    searchStore.closePast();
    run({ kind: past.kind, baseId: past.baseId, request: past.request });
  }

  // 최근 검색에서 고른 thread로 바꾼다. 저장한 첫 페이지를 캐시에 넣어 다시 받지 않는다
  function handleOpenThread(id: string) {
    setRecentOpen(false);
    const thread = getThread(id);
    if (!thread || id === threadId) return;
    abandonSearch();
    for (const turn of thread.turns) {
      const { queryKey } = placeQueries.search(turn.id, turn.request);
      if (!queryClient.getQueryData(queryKey)) {
        queryClient.setQueryData(queryKey, {
          pages: [turn.response],
          pageParams: [undefined],
        });
      }
    }
    searchStore.openThread(thread.id, thread.turns);
    setPanel("middle");
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

  // 주변 카드를 넘기면 그 카드를 선택하고 지도를 그 핀으로 옮긴다
  function handleNearbySelect({ place }: PlaceCard) {
    mapRef.current?.panTo(place);
    searchStore.select(place.id);
  }

  // 결과 목록은 그 카드로 스크롤하고, 주변 카드 목록은 선택이 바뀌면 그 카드로 넘어간다
  function handlePinClick(placeId: number) {
    searchStore.select(placeId);
    document
      .getElementById(placeCardElementId(placeId))
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // 메인 "저장한 장소" 버튼. 비로그인 사용자에게는 로그인 안내를 띄운다(D-7)
  function handleOpenSaved() {
    if (bookmarks.session.status === "guest") {
      setSavedPromptFromMain(true);
      return;
    }
    savedViewState.enter({ from: "main", mainPanel: panel });
    router.push(savedPlacesHref());
  }

  // 앱 안에서 들어왔으면 브라우저 뒤로 가기, 아니면 메인 기본 화면(D-12)
  function handleSavedBack() {
    if (savedViewState.entry()) router.back();
    else router.replace("/");
  }

  function handleSavedPanelChange(next: SavedPanelState) {
    savedViewState.setPanel(next);
    setSavedPanel(next);
  }

  function handleSavedCategory(category?: CategoryGroup) {
    router.replace(savedPlacesHref(category), { scroll: false });
  }

  function handleSavedPinClick(placeId: number) {
    setSavedSelectedId(placeId);
    document
      .getElementById(savedCardElementId(placeId))
      ?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  // "추천 받으러 가기". 보던 검색 결과를 닫고 메인 기본 화면(주변 추천)으로 간다. 최근 검색 기록은 남는다
  function handleRecommend() {
    abandonSearch();
    searchStore.startNewSearch();
    setPanel("middle");
    savedViewState.clear();
    router.replace("/");
  }

  function handleSavedLogin() {
    setSavedPromptFromMain(false);
    savedViewState.clear();
    bookmarks.login(savedPlacesHref(savedView ? savedCategory : undefined));
  }

  async function handleMyLocation() {
    if (!(await locateDevice())) toast(LOCATION_FAILED_MESSAGE);
  }

  const savedItems =
    saved.content.kind === "loaded"
      ? saved.content.items.filter(
          ({ place }) =>
            !savedCategory || place.categoryGroup === savedCategory,
        )
      : [];
  const pinCards = past
    ? pastResults.cards
    : showPanel
      ? results.cards
      : nearby.cards;
  const pins = savedView
    ? savedItems.map(({ place }) => ({
        id: place.id,
        lat: place.lat,
        lng: place.lng,
        bookmark: true,
      }))
    : pinCards.map(({ place }, index) => ({
        id: place.id,
        rank: index + 1,
        lat: place.lat,
        lng: place.lng,
      }));
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
          firstScreen && !savedView
            ? "absolute inset-0"
            : "absolute inset-x-0 top-0 h-1/2"
        }
        pins={pins}
        selectedId={
          savedView
            ? savedSelectedId
            : firstScreen
              ? selectedNearbyId
              : selectedPlaceId
        }
        myLocation={here}
        onPinClick={savedView ? handleSavedPinClick : handlePinClick}
        onUserMove={() => setMapMoved(true)}
        onReadyChange={setMapReady}
      />

      {!savedView && (firstScreen || past || panel !== "full") && (
        <div className="absolute top-4 right-4 flex flex-col gap-2">
          <Fab label="저장한 장소" onClick={handleOpenSaved}>
            <BookmarkIcon className="text-icon" />
          </Fab>
          <Fab label="내 정보" onClick={() => router.push("/my")}>
            <UserIcon className="text-icon" />
          </Fab>
        </div>
      )}

      {!savedView &&
        mapReady &&
        mapMoved &&
        viewing &&
        !past &&
        !searching &&
        panel === "middle" && (
          <Button
            variant="outline"
            size="sm"
            onClick={handleRegionSearch}
            className="absolute top-4 left-1/2 -translate-x-1/2"
          >
            <RefreshIcon size="sm" className="mr-1" />이 지역에서 검색
          </Button>
        )}

      {savedView ? (
        <SavedPlacesView
          content={saved.content}
          category={savedCategory}
          onCategoryChange={handleSavedCategory}
          selectedId={savedSelectedId}
          here={here}
          panel={savedPanel}
          onPanelChange={handleSavedPanelChange}
          onBack={handleSavedBack}
          onRetry={saved.retry}
          onOpen={(placeId) => router.push(placeDetailHref(placeId, true))}
          onRecommend={handleRecommend}
          edge={myLocationButton}
        />
      ) : past ? (
        <PastResultView
          past={past}
          firstPage={pastResults.firstPage}
          cards={pastResults.cards}
          selectedId={selectedPlaceId}
          here={here}
          locating={pastResults.locating}
          unfilteredNearby={pastResults.unfilteredNearby}
          onCardPress={handleCardPress}
          onBack={handleBackFromPast}
          onRepeat={handleRepeatPast}
          edge={myLocationButton}
        />
      ) : showPanel ? (
        <ResultPanel
          state={panel}
          onStateChange={setPanel}
          sentence={
            searching || failed
              ? (search.variables?.request.query ?? "")
              : (viewing?.sentence ?? "")
          }
          searching={searching}
          // "검색 취소"(5-E02). 이전 결과가 있으면 그 결과로, 없으면 첫 화면으로 돌아간다
          onCancelSearch={abandonSearch}
          failure={
            failed && (
              <LoadFailed
                error={search.error}
                title="추천을 불러오지 못했어요"
                onRetry={handleRetrySearch}
              />
            )
          }
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
          onToggleHistory={handleToggleHistory}
          history={
            <HistoryTimeline onView={handleView} onContinue={handleContinue} />
          }
          edge={myLocationButton}
          footer={
            <FollowUpInput
              inputRef={followUpRef}
              onSubmit={handleFollowUp}
              onOpenRecent={() => setRecentOpen(true)}
              disabled={searching}
            />
          }
        />
      ) : (
        <>
          {nearbyOffline && (
            // 연결이 없으면 지도 대신 연결 안내만 보인다(4-E02)
            <div className="absolute inset-0 flex flex-col justify-center bg-surface pb-20">
              <LoadFailed
                error={nearby.error}
                title="주변 추천을 불러오지 못했어요"
                onRetry={nearby.retry}
              />
            </div>
          )}
          {/* 아래부터 검색창, 주변 카드, "내 위치" 순서로 쌓는다(와이어프레임 Start) */}
          <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 pb-4">
            {myLocationButton && !nearbyOffline && (
              <div className="flex justify-end px-4">{myLocationButton}</div>
            )}
            {nearby.error && !nearbyOffline && (
              // 주변 추천을 받지 못하면 카드 자리에 안내를 띄운다(4-E03)
              <div className="mx-4 rounded-lg bg-surface pb-6 shadow-2">
                <LoadFailed
                  error={nearby.error}
                  title="주변 추천을 불러오지 못했어요"
                  onRetry={nearby.retry}
                />
              </div>
            )}
            {nearby.cards.length > 0 && selectedNearbyId !== undefined && (
              <NearbyCarousel
                cards={nearby.cards}
                selectedId={selectedNearbyId}
                origin={nearby.origin}
                originLabel={nearby.originLabel}
                onSelect={handleNearbySelect}
                onOpen={({ place }) => router.push(`/place?id=${place.id}`)}
              />
            )}
            <div className="px-4">
              <SearchBar
                onSearch={handleNewSearch}
                onOpenRecent={() => setRecentOpen(true)}
              />
            </div>
          </div>
        </>
      )}

      <LoginPrompt
        open={
          savedPromptFromMain ||
          (savedView && bookmarks.session.status === "guest")
        }
        description={SAVED_LOGIN_MESSAGE}
        // 저장한 장소 화면에서 뜬 창이면 [취소]는 그 화면의 [뒤로]와 같다
        onCancel={() =>
          savedView ? handleSavedBack() : setSavedPromptFromMain(false)
        }
        onLogin={handleSavedLogin}
      />

      <RecentSearchSheet
        open={recentOpen}
        onOpenChange={setRecentOpen}
        currentThreadId={threadId}
        onPick={handleOpenThread}
      />
    </main>
  );
}
