"use client";

import { useState } from "react";
import { SearchScreen } from "@/domains/place/ui/search-screen";
import { OnboardingScreen } from "@/domains/onboarding/ui/onboarding-screen";

// 향후 가입 화면으로 연결할 때 완료 목적지를 이곳에서 바꾼다.
const COMPLETION_DESTINATION = "home" as const;
export function HomeEntry() {
  const [screen, setScreen] = useState<"onboarding" | "home">("onboarding");
  return screen === "home" ? (
    <SearchScreen />
  ) : (
    <OnboardingScreen onComplete={() => setScreen(COMPLETION_DESTINATION)} />
  );
}
