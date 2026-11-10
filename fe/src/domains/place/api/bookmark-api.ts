import { request } from "@/shared/api/client";

import type { BookmarkItem } from "../model/bookmark";

export function getBookmarks(signal?: AbortSignal) {
  return request<BookmarkItem[]>("/v1/me/bookmarks", {
    signal,
  });
}

export function getBookmarkStatus(placeId: number, signal?: AbortSignal) {
  return request<{ bookmarked: boolean }>(`/v1/me/bookmarks/${placeId}`, {
    signal,
  });
}

export function saveBookmark(placeId: number) {
  return request<void>(`/v1/me/bookmarks/${placeId}`, {
    method: "PUT",
  });
}

export function removeBookmark(placeId: number) {
  return request<void>(`/v1/me/bookmarks/${placeId}`, {
    method: "DELETE",
  });
}
