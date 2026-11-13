"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { restore } from "@/domains/auth/api/auth-client";
import { authenticated } from "@/domains/auth/api/authenticated";
import { useMyMeetups, type WithSession } from "@/domains/meetup/api/queries";
import { MeetupListView } from "@/domains/meetup/ui/meetup-list-view";
import { isApiError } from "@/shared/api/api-error";

import { rememberLoginReturn } from "../login-return";
import { MeetupLoginPrompt } from "./meetup-login-prompt";

const withSession: WithSession = (send) => authenticated(() => send());

// 내 모임(/m). 홈의 시작 버튼이 연다. 로그인하지 않았으면 로그인 안내를 띄우고, 로그인을 마치면 이 화면으로 돌아온다
// (meetup AC-75)
export function MeetupListScreen() {
  const router = useRouter();
  const [signedOut, setSignedOut] = useState(false);
  const list = useMyMeetups(withSession, !signedOut);
  const unauthorized = isApiError(list.error) && list.error.status === 401;

  useEffect(() => {
    let active = true;
    // 숨겨 둔 화면이 로그인 뒤 다시 보일 때도 이 효과가 다시 돌아 안내를 닫는다
    restore().then(
      () => active && setSignedOut(false),
      () => active && setSignedOut(true),
    );
    return () => {
      active = false;
    };
  }, []);

  const leave = useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.replace("/");
  }, [router]);

  const signIn = useCallback(() => {
    rememberLoginReturn("/m");
    router.replace("/login");
  }, [router]);

  return (
    <>
      <MeetupListView
        items={list.data?.items}
        state={
          list.isSuccess
            ? "ready"
            : list.isError && !unauthorized
              ? "error"
              : "loading"
        }
        onBack={leave}
        onCreate={() => router.push("/m/new")}
        onRetry={() => list.refetch()}
      />
      <MeetupLoginPrompt
        open={signedOut || unauthorized}
        onCancel={leave}
        onSignIn={signIn}
      />
    </>
  );
}
