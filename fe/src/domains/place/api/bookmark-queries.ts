import { queryOptions } from "@tanstack/react-query";

import type { BookmarkAccess } from "../model/bookmark";
import { getBookmarkStatus, getBookmarks } from "./bookmark-api";

// 북마크 쿼리 키는 사용자 id를 담아 다른 계정의 캐시가 섞이지 않는다(AC-15)
export const bookmarkKeys = {
  all: ["bookmarks"] as const,
  user: (userId: string) => ["bookmarks", userId] as const,
  status: (userId: string, placeId: number) =>
    ["bookmarks", userId, "status", placeId] as const,
  lists: (userId: string) => ["bookmarks", userId, "list"] as const,
};

// 오프라인이어도 연결을 기다리지 않고 바로 실패하며, 자동 재시도나 연결 복구 뒤 다시 받기가 없다(AC-15)
const noAutoRetry = {
  networkMode: "always",
  retry: false,
  refetchOnReconnect: false,
  refetchOnWindowFocus: false,
} as const;

export const bookmarkQueries = {
  status: (access: BookmarkAccess, userId: string, placeId: number) =>
    queryOptions({
      queryKey: bookmarkKeys.status(userId, placeId),
      queryFn: ({ signal }) =>
        access.send(userId, () => getBookmarkStatus(placeId, signal)),
      ...noAutoRetry,
    }),

  // 저장한 장소 화면에 들어올 때마다 새 entry로 받아 이전 목록을 보이지 않는다(AC-21).
  // 화면을 떠나면 바로 지운다
  list: (access: BookmarkAccess, userId: string, entry: number) =>
    queryOptions({
      queryKey: [...bookmarkKeys.lists(userId), entry] as const,
      queryFn: ({ signal }) => access.send(userId, () => getBookmarks(signal)),
      gcTime: 0,
      ...noAutoRetry,
    }),
};
