import { infiniteQueryOptions, queryOptions } from "@tanstack/react-query";

import type { PlaceSearchRequest } from "../model/place-types";
import { nextPageRequest } from "../model/search-request";
import { getPlace, searchPlaces, suggestPlaces } from "./place-api";

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
        searchPlaces(
          pageParam ? nextPageRequest(request, pageParam) : request,
          signal,
        ),
      initialPageParam: undefined as string | undefined,
      getNextPageParam: (lastPage) => lastPage.nextCursor,
      staleTime: Infinity,
      gcTime: Infinity,
    }),

  detail: (id: number) =>
    queryOptions({
      queryKey: ["places", "detail", id],
      queryFn: ({ signal }) => getPlace(id, signal),
    }),
};
