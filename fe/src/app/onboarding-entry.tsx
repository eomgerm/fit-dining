"use client";

import { useEffect, useLayoutEffect, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { restore } from "@/domains/auth/api/auth-client";
import { isMarkedSignedIn } from "@/domains/auth/model/signed-in-cookie";
import { peekResume, takeResume } from "@/domains/install/model/storage";
import { useHideInstallBanner } from "@/domains/install/ui/install-banner";
import { useInstallIntro } from "@/domains/install/ui/use-install-intro";
import { OnboardingScreen } from "@/domains/onboarding/ui/onboarding-screen";
import {
  isGuest,
  migrateLegacyGuest,
  writeAnswers,
} from "@/domains/onboarding/model/storage";

const subscribeNothing = () => () => {};
const noResume = () => undefined;

// 홈(/)의 기본 화면. 로그인·비회원 표시 쿠키가 없을 때 서버가 고른다(next.config의 / rewrite)
export function OnboardingEntry() {
  const router = useRouter();
  const installIntro = useInstallIntro();
  // 홈 화면 추가 배너(4-01b)는 첫 화면부터 띄운다. 같은 주소의 최초화면·온보딩에서는 숨긴다
  useHideInstallBanner(true);
  // 홈 화면 추가 가이드에서 새로고침한 뒤 돌아오면 이 화면이 새로 그려진다. 누른 버튼이 하던 곳으로 간다(1-01a).
  // 서버 HTML은 최초화면이고, 브라우저에서 남은 값을 읽어 첫 질문부터 다시 그린다.
  // [시작하기]의 표시는 온보딩을 마칠 때 지운다. 그 전에 지우면 상태째 되살아난 화면(Activity)이 최초화면으로 돌아간다
  const resume = useSyncExternalStore(subscribeNothing, peekResume, noResume);
  const onboardingStep = resume === "start" ? 1 : 0;
  useLayoutEffect(() => {
    if (resume !== "login") return;
    takeResume();
    router.replace("/login");
  }, [resume, router]);
  // 표시 쿠키가 없던 로그인 사용자(쿠키 도입 전 로그인 등)와 옛 비회원은 표시를 채운 뒤 검색 홈을 다시 받는다.
  // 표시가 실제로 생겼을 때만 다시 받는다. 쿠키를 막은 브라우저에서 같은 화면이 되풀이되지 않게
  useEffect(() => {
    if (migrateLegacyGuest() || isGuest()) {
      router.refresh();
      return;
    }
    let active = true;
    void restore().then(
      () => {
        if (active && isMarkedSignedIn()) router.refresh();
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [router]);
  return (
    <>
      <OnboardingScreen
        // 가이드에서 돌아와 첫 질문부터 시작할 때 새로 그린다. initialStep은 처음 그릴 때만 읽는다
        key={onboardingStep}
        onComplete={(answers) => {
          takeResume();
          writeAnswers(answers);
          router.push("/signup");
        }}
        interceptIntro={installIntro.intercept}
        initialStep={onboardingStep}
      />
      {installIntro.dialog}
    </>
  );
}
