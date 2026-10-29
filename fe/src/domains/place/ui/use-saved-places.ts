import { useQuery } from "@tanstack/react-query";
import { useEffect, useEffectEvent, useState } from "react";

import { isApiError } from "@/shared/api/api-error";

import { bookmarkQueries } from "../api/bookmark-queries";
import { BookmarkAccountChanged, type BookmarkAccess } from "../model/bookmark";
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

  const query = useQuery({
    ...bookmarkQueries.list(access, userId ?? "", entry),
    enabled: active && userId !== undefined,
  });

  const sessionEnded = active && isSessionEnded(query.error);
  const endSession = useEffectEvent(() => access.endSession());
  useEffect(() => {
    if (sessionEnded) endSession();
  }, [sessionEnded]);

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

  return { content, retry: () => void query.refetch() };
}
