"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

import { restore } from "@/domains/auth/api/auth-client";
import { authenticated } from "@/domains/auth/api/authenticated";
import type { WithSession } from "@/domains/meetup/api/queries";
import { meetupHref } from "@/domains/meetup/model/meetup";
import { MeetupCreateForm } from "@/domains/meetup/ui/meetup-create-form";

import { rememberLoginReturn } from "../../login-return";
import { MeetupLoginPrompt } from "../meetup-login-prompt";

const withSession: WithSession = (send) => authenticated(() => send());

// 모임 만들기(/m/new). 로그인하지 않았으면 로그인 안내를 띄우고, 로그인을 마치면 이 화면으로 돌아온다(AC-25)
export function MeetupNewScreen() {
  const router = useRouter();
  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    let active = true;
    restore().catch(() => active && setSignedOut(true));
    return () => {
      active = false;
    };
  }, []);

  const leave = useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.replace("/");
  }, [router]);

  const signIn = useCallback(() => {
    rememberLoginReturn("/m/new");
    router.replace("/login");
  }, [router]);

  const showLoginPrompt = useCallback(() => setSignedOut(true), []);

  return (
    <>
      <MeetupCreateForm
        withSession={withSession}
        onBack={leave}
        onCreated={(code) => router.replace(`${meetupHref(code)}/join`)}
        onUnauthorized={showLoginPrompt}
      />
      <MeetupLoginPrompt open={signedOut} onCancel={leave} onSignIn={signIn} />
    </>
  );
}
