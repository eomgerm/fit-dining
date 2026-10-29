import { request } from "@/shared/api/client";

import type { BookmarkItem } from "../model/bookmark";

const auth = (accessToken: string) => ({
  Authorization: `Bearer ${accessToken}`,
});

export function getBookmarks(accessToken: string, signal?: AbortSignal) {
  return request<BookmarkItem[]>("/v1/me/bookmarks", {
    headers: auth(accessToken),
    signal,
  });
}

export function getBookmarkStatus(
  placeId: number,
  accessToken: string,
  signal?: AbortSignal,
) {
  return request<{ bookmarked: boolean }>(`/v1/me/bookmarks/${placeId}`, {
    headers: auth(accessToken),
    signal,
  });
}

export function saveBookmark(placeId: number, accessToken: string) {
  return request<void>(`/v1/me/bookmarks/${placeId}`, {
    method: "PUT",
    headers: auth(accessToken),
  });
}

export function removeBookmark(placeId: number, accessToken: string) {
  return request<void>(`/v1/me/bookmarks/${placeId}`, {
    method: "DELETE",
    headers: auth(accessToken),
  });
}
