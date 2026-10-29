"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import {
  clearSession,
  getSession,
  restore,
  subscribe,
} from "@/domains/auth/api/auth-client";
import { withAccessToken } from "@/domains/auth/api/with-access-token";
import { bookmarkKeys } from "@/domains/place/api/bookmark-queries";
import {
  BookmarkAccountChanged,
  type BookmarkAccess,
  type BookmarkSession,
} from "@/domains/place/model/bookmark";

import { rememberLoginReturn } from "./login-return";

const RESTORE_TIMEOUT_MS = 3_000;

// 누른 계정의 AT로만 보낸다(bookmark AC-15). 보내기 전과, 갱신 뒤 다시 보낼 때도 매번
// 지금 세션이 그 계정이고 그 AT인지 확인한다. 다른 탭에서 로그아웃하거나 다른 계정으로 로그인했으면 보내지 않는다
function sendAs<T>(
  userId: string,
  request: (accessToken: string) => Promise<T>,
) {
  if (getSession()?.userId !== userId) {
    return Promise.reject(new BookmarkAccountChanged());
  }
  return withAccessToken((accessToken) => {
    const current = getSession();
    if (current?.userId !== userId || current.accessToken !== accessToken) {
      throw new BookmarkAccountChanged();
    }
    return request(accessToken);
  });
}

const currentUserId = () => getSession()?.userId;

// 페이지를 열 때 세션이 없으면 RT로 복원한다. 3초 안에 끝나지 않거나 실패하면 비로그인으로 보이고,
// 그 뒤 복원이 성공하면 세션 알림으로 로그인한 화면으로 다시 그린다(AC-17)
function useRestoring() {
  const [restoring, setRestoring] = useState(true);
  useEffect(() => {
    let active = true;
    const done = () => {
      if (active) setRestoring(false);
    };
    const timer = setTimeout(done, RESTORE_TIMEOUT_MS);
    restore()
      .catch(() => {})
      .finally(() => {
        clearTimeout(timer);
        done();
      });
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  return restoring;
}

// 장소 화면에 북마크 인증을 이어 준다. place 도메인은 auth 도메인을 import하지 않는다(D-5)
export function useBookmarkAccess(): BookmarkAccess {
  const router = useRouter();
  const queryClient = useQueryClient();
  const restoring = useRestoring();
  const userId = useSyncExternalStore(
    subscribe,
    currentUserId,
    () => undefined,
  );

  // 로그아웃하거나 계정이 바뀌면 이전 계정의 저장 여부·목록 캐시를 지운다
  useEffect(() => {
    queryClient.removeQueries({
      queryKey: bookmarkKeys.all,
      predicate: ({ queryKey }) => queryKey[1] !== userId,
    });
  }, [queryClient, userId]);

  return useMemo(
    () => ({
      session: (userId
        ? { status: "user", userId }
        : {
            status: restoring ? "checking" : "guest",
          }) satisfies BookmarkSession,
      currentUserId,
      send: sendAs,
      endSession: clearSession,
      login(returnTo: string) {
        rememberLoginReturn(returnTo);
        router.push("/login");
      },
    }),
    [restoring, userId, router],
  );
}
