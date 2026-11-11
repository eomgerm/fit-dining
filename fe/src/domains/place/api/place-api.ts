import { request, requestWithHeaders } from "@/shared/api/client";

import type {
  NearbyRequest,
  PlaceDetail,
  PlaceSearchRequest,
  PlaceSearchResponse,
  PlaceSuggestion,
  RegionSearchRequest,
  SearchPreferences,
} from "../model/place-types";

// BE가 AI를 기다리는 12초보다 길어야 대체 결과가 화면에 닿는다(place-ai-search D-3)
const SEARCH_TIMEOUT_MS = 15_000;

// 회원이면 추가 값 없이, 비회원이면 기기의 온보딩 답. 무엇을 실을지는 app이 정한다(D-16)
export type SearchExtras = {
  preferences?: SearchPreferences;
};

// BE가 AI 대신 키워드로 찾은 응답. 검색 기록에 저장되는 본문에 남지 않도록 본문 밖에 표시한다(D-16)
const aiFallbacks = new WeakSet<PlaceSearchResponse>();

export function isAiFallback(response: PlaceSearchResponse | undefined) {
  return response !== undefined && aiFallbacks.has(response);
}

// 대체 안내를 띄울지. 카드가 없으면 emptyReason만 보인다(AC-27)
export function showsAiFallback(response: PlaceSearchResponse | undefined) {
  return isAiFallback(response) && response?.items.length !== 0;
}

export function suggestPlaces(q: string, signal?: AbortSignal) {
  return request<PlaceSuggestion[]>("/v1/places/suggest", {
    query: { q },
    signal,
  });
}

export function searchPlaces(
  body: PlaceSearchRequest,
  signal?: AbortSignal,
  extras?: SearchExtras,
) {
  return postSearch("/v1/places/search", body, signal, extras);
}

// "이 지역에서 검색". 비회원 답, 시간 초과, X-Fallback 처리는 검색과 같다(D-109)
export function searchRegion(
  body: RegionSearchRequest,
  signal?: AbortSignal,
  extras?: SearchExtras,
) {
  return postSearch("/v1/places/search/region", body, signal, extras);
}

// 홈 주변 카드(spec 70번). 비회원 답, 시간 초과, X-Fallback 처리는 검색과 같다(D-111)
export function searchNearby(
  body: NearbyRequest,
  signal?: AbortSignal,
  extras?: SearchExtras,
) {
  return postSearch("/v1/places/nearby", body, signal, extras);
}

async function postSearch(
  path: string,
  body: PlaceSearchRequest | RegionSearchRequest | NearbyRequest,
  signal?: AbortSignal,
  { preferences }: SearchExtras = {},
) {
  const { data, headers } = await requestWithHeaders<PlaceSearchResponse>(
    path,
    {
      method: "POST",
      body: preferences ? { ...body, preferences } : body,
      signal,
      timeoutMs: SEARCH_TIMEOUT_MS,
    },
  );
  if (headers.get("X-Fallback")?.split(",").includes("AI_UNAVAILABLE")) {
    aiFallbacks.add(data);
  }
  return data;
}

export function getPlace(id: number, signal?: AbortSignal) {
  return request<PlaceDetail>(`/v1/places/${id}`, { signal });
}

// 열 수 있는 모든 장소 id(장소 sitemap)
export function getPlaceIds() {
  return request<number[]>("/v1/places/ids");
}
