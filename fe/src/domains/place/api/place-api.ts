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
    signal,
  });
}

export function getPlace(id: number, signal?: AbortSignal) {
  return request<PlaceDetail>(`/v1/places/${id}`, { signal });
}
