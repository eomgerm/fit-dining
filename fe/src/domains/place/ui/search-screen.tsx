"use client";

import {
  useMutation,
  useQueryClient,
  type QueryKey,
} from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import {
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
} from "react";

import { prefersReducedMotion } from "@/shared/lib/reduced-motion";
import { Button } from "@/shared/ui/button/button";
import { Fab } from "@/shared/ui/button/fab";
import { BookmarkIcon } from "@/shared/ui/icon/icons/bookmark";
import { MyLocationIcon } from "@/shared/ui/icon/icons/my-location";
import { RefreshIcon } from "@/shared/ui/icon/icons/refresh";
import { UserIcon } from "@/shared/ui/icon/icons/user";
import { StatusBarColor } from "@/shared/ui/layout/status-bar-color";
import { useToast } from "@/shared/ui/overlay/toast";

import { placeQueries } from "../api/place-queries";
import {
  parseCategory,
  placeDetailHref,
  SAVED_VIEW,
  savedPlacesHref,
  type BookmarkAccess,
} from "../model/bookmark";
import type {
  CategoryGroup,
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
  requestTitle,
  searchStore,
  type EntryKind,
} from "../model/search-store";
import type { SearchThread } from "../model/search-threads";
import { FollowUpInput } from "./follow-up-input";
import { HistoryTimeline } from "./history-timeline";
import { isOfflineError, LoadFailed } from "./load-failed";
import {
  initialLocation,
  LOCATION_DENIED_MESSAGE,
  LOCATION_FAILED_MESSAGE,
  locateFromButton,
} from "./locate-device";
import { LoginPrompt, SAVED_LOGIN_MESSAGE } from "./login-prompt";
import { NearbyCarousel } from "./nearby-carousel";
import { PastResultView } from "./past-result-view";
import { placeCardElementId } from "./place-card";
import { PlaceMap, type PlaceMapHandle } from "./place-map";
import { RecentSearchSheet } from "./recent-search-sheet";
import type { PanelState } from "./map-panel";
import { AiFallbackNote, ResultPanel } from "./result-panel";
import { savedCardElementId, SavedPlacesView } from "./saved-places";
import { savedViewState, type SavedPanelState } from "./saved-view-state";
import { SearchBar } from "./search-bar";
import { beginSave, saveTurn, type ThreadAuth } from "./thread-storage";
import { keyboardLift, useKeyboardInset } from "./use-keyboard-inset";
import { useNearbyPicks } from "./use-nearby-picks";
import { useSavedPlaces } from "./use-saved-places";
import { useHere, useSearchStore } from "./use-search-store";
import { usePastResults, useViewingResults } from "./use-viewing-results";

type SearchInput = {
  kind: EntryKind;
  baseId?: string;
  request: PlaceSearchRequest;
};

type SearchScreenProps = {
  // 저장한 장소의 인증. 인증 도메인을 쓰는 app이 넘긴다
  bookmarks: BookmarkAccess;
  // 회원 검색 기록을 서버에 저장하는 인증 연결. 없으면 비회원처럼 기기에 저장한다(search-thread D-6)
  threadAuth?: ThreadAuth;
};

// 첫 화면(와이어프레임 Start)과 검색·추천 결과 화면(5-01, 5-03~5-07), 저장한 장소 화면(?view=saved, 와이어프레임 Saved)
export function SearchScreen({ bookmarks, threadAuth }: SearchScreenProps) {
  const router = useRouter();
  const params = useSearchParams();
  // 저장한 장소 화면은 메인의 지도와 하단 패널이 내 저장 장소만 보이도록 바뀐 상태다(D-12)
  const savedView = params.get("view") === SAVED_VIEW;
  const savedCategory = parseCategory(params.get("category"));
  const queryClient = useQueryClient();
  const toast = useToast();
  const {
    threadId,
    entries,
    selectedPlaceId,
    epoch,
    initialView,
    locationNotice,
  } = useSearchStore();
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
  // "내 위치"를 눌러 위치를 찾고 지도를 옮기는 중. 버튼 아이콘이 파란색이다(D-100)
  const [locating, setLocating] = useState(false);
  // 화면 키보드 높이. 바닥의 검색창·후속 입력창만 그만큼 올린다
  const keyboardInset = useKeyboardInset();

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
  // 쌓은 요청은 그때 받은 첫 페이지와 함께 지금 thread에 저장한다. 저장 위치는 검색을 시작할 때의 로그인 세션으로 정하고,
  // 그사이 세션이 바뀌었으면(epoch) 응답을 버린다(search-thread D-6)
  const search = useMutation({
    mutationFn: async ({ kind, baseId, request }: SearchInput) => {
      const generation = searchGeneration.current;
      const startEpoch = searchStore.getSnapshot().epoch;
      const target = beginSave(threadAuth);
      const id = nextEntryId();
      const options = placeQueries.search(id, request);
      pendingKey.current = options.queryKey;
      try {
        const data = await queryClient.fetchInfiniteQuery(options);
        if (
          generation !== searchGeneration.current ||
          startEpoch !== searchStore.getSnapshot().epoch
        ) {
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
          saveTurn(
            target,
            thread,
            {
              id,
              kind,
              ...(baseId && { baseId }),
              at: entry.at,
              request,
              response,
            },
            threadAuth,
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
  // 고른 적이 없으면 첫 카드가 선택된 카드다
  const selectedNearbyId = nearby.cards.some(
    ({ place }) => place.id === selectedPlaceId,
  )
    ? selectedPlaceId
    : nearby.cards[0]?.place.id;

  // 앱을 열 때의 위치 결정은 페이지 세션에 한 번이고, 다시 들어온 화면은 같은 결과를 기다린다(spec 40번)
  useEffect(() => {
    void initialLocation();
  }, []);

  // 앱을 연 뒤 처음 얻은 위치로 지도를 한 번만 옮긴다. 확대 정도는 그대로다. here가 바뀐 것만으로는 옮기지 않고,
  // 이미 다른 화면이 옮기는 중이거나 끝났으면(버튼, 사용자가 지도를 움직임) 옮기지 않는다(spec 62번)
  useEffect(() => {
    if (initialView !== "pending" || !mapReady || !here) return;
    if (!searchStore.startInitialView()) return;
    const move = mapRef.current?.panTo(here) ?? Promise.resolve();
    void move.then(() => searchStore.finishInitialView());
  }, [initialView, mapReady, here]);

  // 처음 조회의 알림은 지금 보이는 화면이 한 번 가져가 띄운다. 숨겨진 화면은 Effect가 돌지 않는다(spec 63번)
  const showLocationNotice = useEffectEvent(() => {
    const notice = searchStore.takeLocationNotice();
    if (notice === "denied") toast(LOCATION_DENIED_MESSAGE);
    if (notice === "failed") toast(LOCATION_FAILED_MESSAGE);
  });
  useEffect(() => {
    if (locationNotice) showLocationNotice();
  }, [locationNotice]);

  // 다른 화면으로 가면(Next가 이 화면을 숨기면) 찾는 중 표시를 끈다
  useEffect(() => () => setLocating(false), []);

  useEffect(() => {
    if (focusRequest > 0 && !searching) followUpRef.current?.focus();
  }, [focusRequest, searching]);

  // 로그인 세션이 바뀌어 store를 비웠으면 진행 중인 검색과 열린 시트도 버리고 첫 화면으로 돌아간다
  const clearForSession = useEffectEvent(() => {
    abandonSearch();
    setRecentOpen(false);
    setPanel("middle");
  });
  const seenEpoch = useRef(epoch);
  useEffect(() => {
    if (seenEpoch.current === epoch) return;
    seenEpoch.current = epoch;
    clearForSession();
  }, [epoch]);

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

  // 최근 검색에서 받아 온 thread로 바꾼다. 저장한 첫 페이지를 캐시에 넣어 검색을 다시 부르지 않는다.
  // 이번 페이지 세션에 이미 받은 turn은 캐시를 그대로 쓴다(spec 57번)
  function handleOpenThread(thread: SearchThread) {
    // 받는 사이 로그인 세션이 바뀌었으면 이전 세션의 thread다
    if (searchStore.getSnapshot().epoch !== seenEpoch.current) return;
    setRecentOpen(false);
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
      router.push(placeDetailHref(place.id));
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
    document.getElementById(placeCardElementId(placeId))?.scrollIntoView({
      block: "nearest",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
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
    document.getElementById(savedCardElementId(placeId))?.scrollIntoView({
      block: "nearest",
      behavior: prefersReducedMotion() ? "auto" : "smooth",
    });
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

  // 찾는 중에 다시 누르면 무시한다. 남은 처음 이동을 대신하고, 얻은 위치로 확대 정도를 첫 화면과 같게 맞추며
  // 옮긴 뒤 파란색을 끈다(D-100, D-104). 실패 알림은 누를 때마다 띄운다
  async function handleMyLocation() {
    if (locating) return;
    setLocating(true);
    const found = await locateFromButton();
    if (!found) {
      setLocating(false);
      toast(LOCATION_FAILED_MESSAGE);
      return;
    }
    await mapRef.current?.panTo(found, { resetZoom: true });
    setLocating(false);
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
  // 지도는 메인과 저장한 장소 화면이 함께 쓴다. 화면마다 핀, 선택, 크기만 다르다
  const map = savedView
    ? {
        full: false,
        pins: savedItems.map(({ place: { id, lat, lng } }) => ({
          id,
          lat,
          lng,
          mark: "bookmark" as const,
        })),
        selectedId: savedSelectedId,
        onPinClick: handleSavedPinClick,
      }
    : {
        full: firstScreen,
        pins: pinCards.map(({ place: { id, lat, lng } }, index) => ({
          id,
          lat,
          lng,
          mark: index + 1,
        })),
        selectedId: firstScreen ? selectedNearbyId : selectedPlaceId,
        onPinClick: handlePinClick,
      };
  const myLocationButton = mapReady && (
    <Fab label="내 위치" aria-busy={locating} onClick={handleMyLocation}>
      <MyLocationIcon className={locating ? "text-location" : "text-icon"} />
    </Fab>
  );

  return (
    <main
      style={{ "--keyboard-inset": `${keyboardInset}px` } as CSSProperties}
      data-keyboard-open={keyboardInset > 0 || undefined}
      className="relative h-viewport overflow-hidden"
    >
      {/* 지도 화면의 상태바는 흰색으로 칠한다(블러 대신) */}
      <StatusBarColor />
      <PlaceMap
        ref={mapRef}
        // 패널이 있으면 지도를 패널 위쪽에 맞춰 지도 중심과 핀이 가려지지 않게 한다(조금 겹친다)
        className={
          map.full ? "absolute inset-0" : "absolute inset-x-0 top-0 h-1/2"
        }
        rememberView
        pins={map.pins}
        selectedId={map.selectedId}
        myLocation={here}
        onPinClick={map.onPinClick}
        onUserMove={() => {
          setMapMoved(true);
          // 사용자가 지도를 움직이면 남은 처음 이동은 하지 않는다(spec 62번)
          searchStore.finishInitialView();
        }}
        onReadyChange={setMapReady}
        onUnavailable={searchStore.finishInitialView}
      />

      {/* 저장한 장소 화면에는 [뒤로]와 "내 위치"만 있다(D-12) */}
      {!savedView && (
        <>
          {/* 과거 결과 화면에는 "현재 검색으로"만 둔다(D-98) */}
          {(firstScreen || (!past && panel !== "full")) && (
            <div className="absolute top-safe-4 right-4 flex flex-col gap-2">
              <Fab label="저장한 장소" onClick={handleOpenSaved}>
                <BookmarkIcon className="text-icon" />
              </Fab>
              <Fab label="내 정보" onClick={() => router.push("/my")}>
                <UserIcon className="text-icon" />
              </Fab>
            </div>
          )}

          {mapReady &&
            mapMoved &&
            viewing &&
            !past &&
            !searching &&
            panel === "middle" && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleRegionSearch}
                className="absolute top-safe-4 left-1/2 -translate-x-1/2"
              >
                <RefreshIcon size="sm" className="mr-1" />이 지역에서 검색
              </Button>
            )}
        </>
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
          onRemove={saved.remove}
          removing={saved.removing}
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
          // 첫 요청 문장. 검색 중이면 보낸 요청의 기준 요청에서 찾고, 새 검색이면 보낸 문장이다(D-97)
          sentence={
            (searching || failed
              ? (requestTitle(entries, search.variables?.baseId) ??
                search.variables?.request.query)
              : requestTitle(entries, viewing?.id)) ?? ""
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
            // 연결이 없으면 지도 대신 연결 안내만 보인다(4-E02).
            // 안내는 자체 위아래 여백을 뺀 높이의 60%만큼 가운데에서 올린다
            <div className="absolute inset-0 bg-surface-warm">
              <div className="absolute inset-x-0 top-1/2 -translate-y-3/5">
                <LoadFailed
                  error={nearby.error}
                  title="주변 추천을 불러오지 못했어요"
                  onRetry={nearby.retry}
                  className="-mt-7 -mb-2"
                />
              </div>
            </div>
          )}
          {/* 아래부터 검색창, 주변 카드, "내 위치" 순서로 쌓는다(와이어프레임 Start) */}
          <div className="absolute inset-x-0 bottom-0 flex flex-col gap-3 pb-safe-4">
            {myLocationButton && !nearbyOffline && (
              <div className="flex justify-end px-4">{myLocationButton}</div>
            )}
            {nearby.error && !nearbyOffline && (
              // 주변 추천을 받지 못하면 카드 자리에 안내를 띄운다(4-E03)
              // 카드 안 위 24px, 아래 20px. 안내 자체 여백(위 28px, 아래 8px)에 맞춘다
              <div className="mx-4 mb-0.5 rounded-lg bg-surface pb-3 shadow-2">
                <LoadFailed
                  error={nearby.error}
                  title="주변 추천을 불러오지 못했어요"
                  onRetry={nearby.retry}
                  className="-mt-1"
                />
              </div>
            )}
            {nearby.cards.length > 0 && selectedNearbyId !== undefined && (
              <>
                {nearby.aiFallback && <AiFallbackNote className="mx-4" />}
                <NearbyCarousel
                  cards={nearby.cards}
                  selectedId={selectedNearbyId}
                  origin={nearby.origin}
                  originLabel={nearby.originLabel}
                  onSelect={handleNearbySelect}
                  onOpen={({ place }) => router.push(placeDetailHref(place.id))}
                />
              </>
            )}
            <div
              className="px-4"
              // 검색창과 후보만 키보드 위로 올린다(SearchBar가 읽는다)
              style={{ "--keyboard-lift": keyboardLift(4) } as CSSProperties}
            >
              <SearchBar
                onSearch={handleNewSearch}
                onOpenRecent={() => setRecentOpen(true)}
                // 연결이 없으면 검색창을 끈다(4-E02)
                disabled={nearbyOffline}
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
        threadAuth={threadAuth}
        currentThreadId={threadId}
        onOpenThread={handleOpenThread}
      />
    </main>
  );
}
