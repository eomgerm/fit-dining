import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useState } from "react";

import { isApiError } from "@/shared/api/api-error";
import { useToast } from "@/shared/ui/overlay/toast";

import { removeBookmark } from "../api/bookmark-api";
import { bookmarkKeys, bookmarkQueries } from "../api/bookmark-queries";
import {
  BookmarkAccountChanged,
  type BookmarkAccess,
  type BookmarkItem,
} from "../model/bookmark";
import { isSessionEnded } from "./bookmark-button";
import type { SavedContent } from "./saved-places";

// 저장한 장소 화면의 목록(D-13, D-14). active인 동안만 받는다.
// 화면에 들어올 때마다 새 키로 받아 받는 동안 이전 목록을 보이지 않는다(AC-21).
// 목록 요청이 세션 종료(401)로 끝나면 로그인 정보를 지워 비로그인 화면이 된다(AC-17)
export function useSavedPlaces(access: BookmarkAccess, active: boolean) {
  const { session } = access;
  const userId = session.status === "user" ? session.userId : undefined;
  const [entry, setEntry] = useState(0);
  const [wasActive, setWasActive] = useState(active);
  if (active !== wasActive) {
    setWasActive(active);
    if (active) setEntry((count) => count + 1);
  }

  const listOptions = bookmarkQueries.list(access, userId ?? "", entry);
  const query = useQuery({
    ...listOptions,
    enabled: active && userId !== undefined,
  });
  const queryClient = useQueryClient();
  const toast = useToast();
  // 해제하는 중인 장소. 응답이 올 때까지 그 카드의 메뉴를 누를 수 없다
  const [removing, setRemoving] = useState<ReadonlySet<number>>(new Set());

  const sessionEnded = active && isSessionEnded(query.error);
  const endSession = useEffectEvent(() => access.endSession());
  useEffect(() => {
    if (sessionEnded) endSession();
  }, [sessionEnded]);

  // 목록 카드의 ⋯ 메뉴에서 해제한다. 성공하면 목록을 다시 받지 않고 그 장소만 뺀다(D-18)
  async function remove(placeId: number) {
    if (!userId || removing.has(placeId)) return;
    setRemoving((ids) => new Set(ids).add(placeId));
    try {
      await access.send(userId, (token) => removeBookmark(placeId, token));
    } catch (error) {
      if (error instanceof BookmarkAccountChanged) return;
      const current = access.currentUserId();
      // 401이면 로그인 정보를 지워 로그인 안내가 뜬다(AC-17). 그사이 다른 계정이면 결과를 버린다
      if (isSessionEnded(error)) {
        if (current === undefined || current === userId) access.endSession();
        return;
      }
      if (current !== userId) return;
      toast(
        isApiError(error) && error.kind === "network"
          ? "인터넷 연결을 확인하고 다시 시도해 주세요."
          : "저장을 해제하지 못했어요. 다시 시도해 주세요.",
      );
      return;
    } finally {
      setRemoving((ids) => {
        const next = new Set(ids);
        next.delete(placeId);
        return next;
      });
    }
    if (access.currentUserId() !== userId) return;
    queryClient.setQueryData<BookmarkItem[]>(listOptions.queryKey, (items) =>
      items?.filter(({ place }) => place.id !== placeId),
    );
    queryClient.setQueryData(bookmarkKeys.status(userId, placeId), {
      bookmarked: false,
    });
    toast("저장을 해제했어요");
  }

  let content: SavedContent;
  if (session.status === "guest") content = { kind: "titleOnly" };
  // [다시 시도]로 다시 받는 동안에도 로딩을 보인다
  else if (!userId || query.isPending || query.isFetching)
    content = { kind: "loading" };
  else if (query.isError) {
    const { error } = query;
    if (isSessionEnded(error)) content = { kind: "titleOnly" };
    else if (error instanceof BookmarkAccountChanged)
      content = { kind: "loading" };
    else if (isApiError(error) && error.kind === "network")
      content = { kind: "offline" };
    else content = { kind: "failed" };
  } else content = { kind: "loaded", items: query.data };

  return {
    content,
    retry: () => void query.refetch(),
    remove: (placeId: number) => void remove(placeId),
    removing,
  };
}
