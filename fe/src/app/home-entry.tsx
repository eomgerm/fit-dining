"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { restore } from "@/domains/auth/api/auth-client";
import { SearchScreen } from "@/domains/place/ui/search-screen";
import { OnboardingScreen } from "@/domains/onboarding/ui/onboarding-screen";
import { isGuest, writeAnswers } from "@/domains/onboarding/model/storage";

export function HomeEntry() {
  const router = useRouter();
  const [screen, setScreen] = useState<"checking" | "onboarding" | "home">(
    "checking",
  );
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      if (active) {
        active = false;
        setScreen(isGuest() ? "home" : "onboarding");
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
        setScreen(loggedIn || isGuest() ? "home" : "onboarding");
      });
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, []);
  if (screen === "checking") return <main className="min-h-svh bg-surface" />;
  return screen === "home" ? (
    <SearchScreen />
  ) : (
    <OnboardingScreen
      onComplete={(answers) => {
        writeAnswers(answers);
        router.push("/signup");
      }}
    />
  );
}
