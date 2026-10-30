"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { restore } from "@/domains/auth/api/auth-client";

import { rememberLoginReturn } from "../../login-return";

// 장소 상세 주소. 상세 탭은 화면 상태라 주소에 싣지 않는다(D-32)
function placeDetailHref(placeId: number) {
  return `/place?id=${placeId}`;
}

// 리뷰는 로그인한 사용자만 쓰고 고친다. 들어올 때 세션을 확인하고, 없으면 로그인 화면으로 바꿔치기해
// 로그인 화면의 "뒤로"가 이 화면이 아니라 장소 상세로 가게 한다. 로그인한 뒤 이 화면으로 돌아오게 주소를 남긴다(D-48)
export function useSignedIn() {
  const router = useRouter();
  const [signedIn, setSignedIn] = useState(false);
  const goToLogin = useCallback(() => {
    rememberLoginReturn(window.location.pathname + window.location.search);
    router.replace("/login");
  }, [router]);

  useEffect(() => {
    let active = true;
    restore().then(
      () => active && setSignedIn(true),
      () => active && goToLogin(),
    );
    return () => {
      active = false;
    };
  }, [goToLogin]);

  return { signedIn, goToLogin };
}

// 작성·수정 화면에서 나간다. 장소 상세에서 들어왔으면 뒤로 가서 보던 탭 그대로 돌아가고,
// 주소로 바로 열었으면 장소 상세로 바꿔치기한다. 등록 뒤에 상세 주소로 바꿔치기하면
// 방문 기록에 상세가 두 번 남아 상세의 "뒤로"를 두 번 눌러야 한다(D-32)
export function useLeave() {
  const router = useRouter();
  return useCallback(
    (placeId: number) => {
      if (window.history.length > 1) router.back();
      else router.replace(placeDetailHref(placeId));
    },
    [router],
  );
}
