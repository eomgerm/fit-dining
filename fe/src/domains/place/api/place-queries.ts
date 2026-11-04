import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import type { PlaceSearchRequest } from "../model/place-types";
import { nearbyRequest, nextPageRequest } from "../model/search-request";
import {
  getPlace,
  isAiFallback,
  searchPlaces,
  suggestPlaces,
  type SearchExtras,
} from "./place-api";

// 검색 요청마다 실을 토큰이나 비회원 답을 정해 send를 부른다.
// place는 auth와 onboarding을 import하지 않으므로 app이 정한다(place-ai-search D-16)
export type SearchAccess = <T>(
  send: (extras: SearchExtras) => Promise<T>,
) => Promise<T>;

// app이 정하기 전에는 아무것도 싣지 않는다
let searchAccess: SearchAccess = (send) => send({});

export function setSearchAccess(access: SearchAccess) {
  searchAccess = access;
}

// 장소 쿼리 키와 queryOptions는 여기서만 만든다. ui는 useQuery(placeQueries.detail(id))처럼 넘겨 쓴다
export const placeQueries = {
  // 키가 바뀌면 Query가 이전 요청의 signal을 중단한다
  suggest: (q: string) =>
    queryOptions({
      queryKey: ["places", "suggest", q],
      queryFn: ({ signal }) => suggestPlaces(q, signal),
    }),

  // 요청 기록 항목마다 무한 쿼리 하나. "결과 보기"와 상세에서 돌아오기가 네트워크 없이 캐시로 동작하도록
  // 지우지도, 다시 받지도 않는다. 다음 페이지는 첫 요청 본문에 cursor만 더해 보낸다
  search: (entryId: string, request: PlaceSearchRequest) =>
    infiniteQueryOptions({
      queryKey: ["places", "search", entryId],
      queryFn: ({ pageParam, signal }) =>
        searchAccess((extras) =>
          searchPlaces(
            pageParam ? nextPageRequest(request, pageParam) : request,
            signal,
            extras,
          ),
        ),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      staleTime: Infinity,
      gcTime: Infinity,
    }),

  // 첫 화면 주변 카드. 요청 기록 항목이 아니라 키가 따로이고, 페이지 세션 동안 다시 받지 않는다.
  // AI 대신 키워드로 찾은 결과만은 첫 화면을 다시 그릴 때 새로 받는다. 포커스와 재연결로는 받지 않는다(D-16)
  nearby: () =>
    queryOptions({
      queryKey: ["places", "nearby"],
      queryFn: ({ signal }) =>
        searchAccess((extras) => searchPlaces(nearbyRequest(), signal, extras)),
      staleTime: ({ state }) => (isAiFallback(state.data) ? 0 : Infinity),
      gcTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    }),

  detail: (id: number) =>
    queryOptions({
      queryKey: ["places", "detail", id],
      queryFn: ({ signal }) => getPlace(id, signal),
      // 서버가 페이지에 넣어 보낸 상세를 열자마자 다시 받지 않는다. 장소 정보는 자주 바뀌지 않는다
      staleTime: 60_000,
    }),
};
