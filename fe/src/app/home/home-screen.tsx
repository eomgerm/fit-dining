"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { restore } from "@/domains/auth/api/auth-client";
import { isMarkedSignedIn } from "@/domains/auth/model/signed-in-cookie";
import { isGuest } from "@/domains/onboarding/model/storage";
import { SearchScreen } from "@/domains/place/ui/search-screen";
import { takeLoginReturn } from "../login-return";
import { threadAuth } from "../search-thread-auth";
import { useBookmarkAccess } from "../use-bookmark-access";

// 홈(/)의 검색 홈. 로그인·비회원 표시 쿠키가 있을 때 서버가 고른다(next.config의 / rewrite)
export function HomeScreen() {
  const router = useRouter();
  const bookmarks = useBookmarkAccess();
  useEffect(() => {
    let active = true;
    // 쿼리 없는 홈에 도착했을 때만 북마크 로그인 안내가 남긴 주소를 읽어 지운다(북마크 D-8)
    const arrivedHome = window.location.search === "";
    void restore()
      .then(
        () => true,
        () => false,
      )
      .then((loggedIn) => {
        if (!active) return;
        const returnTo = arrivedHome ? takeLoginReturn() : undefined;
        if (loggedIn && returnTo) router.replace(returnTo);
        // 세션이 끝나 로그인 표시가 지워졌고 비회원도 아니면 서버가 온보딩을 주도록 다시 받는다.
        // 연결 실패는 표시가 남아 그대로 둔다
        else if (!isMarkedSignedIn() && !isGuest()) router.refresh();
      });
    return () => {
      active = false;
    };
  }, [router]);
  // 검색 기록 저장에 인증을 잇는다. place는 auth를 import하지 않는다(search-thread D-6)
  return <SearchScreen bookmarks={bookmarks} threadAuth={threadAuth} />;
}
