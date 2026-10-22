import { request } from "@/shared/api/client";

import type {
  PlaceDetail,
  PlaceSearchRequest,
  PlaceSearchResponse,
  PlaceSuggestion,
} from "../model/place-types";

export function suggestPlaces(q: string, signal?: AbortSignal) {
  return request<PlaceSuggestion[]>("/v1/places/suggest", {
    query: { q },
    signal,
  });
}

export function searchPlaces(body: PlaceSearchRequest, signal?: AbortSignal) {
  return request<PlaceSearchResponse>("/v1/places/search", {
    method: "POST",
    body,
    headers: mockScenarioHeaders(),
    signal,
  });
}

export function getPlace(id: number, signal?: AbortSignal) {
  return request<PlaceDetail>(`/v1/places/${id}`, { signal });
}

// 개발자가 주소에 ?mock=empty를 붙이면 BE Mock이 결과 없음을 돌려준다.
// 호출마다 읽어서 커서 요청에도 붙는다. 브라우저의 globalThis.location은 window.location이다
function mockScenarioHeaders(): HeadersInit | undefined {
  const search = globalThis.location?.search ?? "";
  if (new URLSearchParams(search).get("mock") !== "empty") return;
  return { "X-Mock-Scenario": "empty" };
}
