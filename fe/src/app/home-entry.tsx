"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { restore } from "@/domains/auth/api/auth-client";
import { takeResume } from "@/domains/install/model/storage";
import { useHideInstallBanner } from "@/domains/install/ui/install-banner";
import { useInstallIntro } from "@/domains/install/ui/use-install-intro";
import { SearchScreen } from "@/domains/place/ui/search-screen";
import { OnboardingScreen } from "@/domains/onboarding/ui/onboarding-screen";
import { isGuest, writeAnswers } from "@/domains/onboarding/model/storage";
import { takeLoginReturn } from "./login-return";
import { threadAuth } from "./search-thread-auth";
import { useBookmarkAccess } from "./use-bookmark-access";

export function HomeEntry() {
  const router = useRouter();
  const bookmarks = useBookmarkAccess();
  const installIntro = useInstallIntro();
  const [screen, setScreen] = useState<"checking" | "onboarding" | "home">(
    "checking",
  );
  // 홈 화면 추가 배너(4-01b)는 첫 화면부터 띄운다. 같은 주소의 최초화면·온보딩에서는 숨긴다
  useHideInstallBanner(screen !== "home");
  // 가이드 화면에서 새로고침한 뒤 돌아오면 이 화면이 새로 그려지므로 첫 질문부터 시작한다.
  // 상태째 되살아나는 보통의 뒤로 가기는 가이드로 갈 때 이미 온보딩으로 바꿔 두어 여기를 거치지 않는다
  const [onboardingStep, setOnboardingStep] = useState(0);
  useEffect(() => {
    let active = true;
    // 쿼리 없는 홈에 도착했을 때만 북마크 로그인 안내가 남긴 주소를 읽어 지운다(북마크 D-8)
    const arrivedHome = window.location.search === "";
    function settle(home: boolean) {
      // 홈 화면 추가 가이드에서 돌아왔으면 최초화면을 건너뛰고 누른 버튼이 하던 곳으로 간다(1-01a)
      const resume = takeResume();
      if (!home && resume === "login") {
        router.replace("/login");
        return;
      }
      if (!home && resume === "start") setOnboardingStep(1);
      setScreen(home ? "home" : "onboarding");
    }
    const timer = setTimeout(() => {
      if (active) {
        active = false;
        if (arrivedHome) takeLoginReturn();
        settle(isGuest());
      }
    }, 3000);
    void restore()
      .then(
        () => true,
        () => false,
      )
      .then((loggedIn) => {
        if (!active) return;
        clearTimeout(timer);
        const returnTo = arrivedHome ? takeLoginReturn() : undefined;
        if (loggedIn && returnTo) {
          router.replace(returnTo);
          // 다른 화면으로 가면 이 화면은 그리지 않는다
          if (!returnTo.startsWith("/?")) return;
        }
        settle(loggedIn || isGuest());
      });
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [router]);
  if (screen === "checking") return <main className="min-h-svh bg-surface" />;
  return screen === "home" ? (
    // 검색 기록 저장에 인증을 잇는다. place는 auth를 import하지 않는다(search-thread D-6)
    <SearchScreen bookmarks={bookmarks} threadAuth={threadAuth} />
  ) : (
    <>
      <OnboardingScreen
        onComplete={(answers) => {
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
