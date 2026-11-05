import { request, requestWithHeaders } from "@/shared/api/client";

import type {
  PlaceDetail,
  PlaceSearchRequest,
  PlaceSearchResponse,
  PlaceSuggestion,
  SearchPreferences,
} from "../model/place-types";

// BE가 AI를 기다리는 12초보다 길어야 대체 결과가 화면에 닿는다(place-ai-search D-3)
const SEARCH_TIMEOUT_MS = 15_000;

// 회원이면 토큰, 비회원이면 기기의 온보딩 답. 무엇을 실을지는 app이 정한다(D-16)
export type SearchExtras = {
  accessToken?: string;
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

export async function searchPlaces(
  body: PlaceSearchRequest,
  signal?: AbortSignal,
  { accessToken, preferences }: SearchExtras = {},
) {
  const { data, headers } = await requestWithHeaders<PlaceSearchResponse>(
    "/v1/places/search",
    {
      method: "POST",
      body: preferences ? { ...body, preferences } : body,
      headers: accessToken
        ? { Authorization: `Bearer ${accessToken}` }
        : undefined,
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
