"use client";

import { useRouter } from "next/navigation";
import { useSyncExternalStore } from "react";
import {
  installSnapshot,
  promptInstall,
  subscribeInstall,
  type InstallSnapshot,
} from "../model/install-prompt";
import { installPlatform } from "../model/platform";

const serverSnapshot: InstallSnapshot = { canPrompt: false, installed: false };
const subscribeNothing = () => () => {};

// 홈 화면에서 연 앱인지. iOS 15 이하 Safari는 display-mode 대신 navigator.standalone만 알려 준다
function standalone() {
  return (
    window.matchMedia?.("(display-mode: standalone)").matches === true ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

// 설치 안내(모달·배너)를 띄울지와, [홈 화면에 추가]를 눌렀을 때 할 일
export function useInstall() {
  const router = useRouter();
  const { canPrompt, installed } = useSyncExternalStore(
    subscribeInstall,
    installSnapshot,
    () => serverSnapshot,
  );
  // 서버에서는 알 수 없으므로 앱으로 본다. 안내가 깜빡였다 사라지지 않게 한다
  const inApp = useSyncExternalStore(subscribeNothing, standalone, () => true);

  // Chrome이 설치 창을 띄울 수 있으면 띄우고, 아니면 브라우저 메뉴 경로 안내로 간다(1-01b·1-01c·1-01d)
  // onPrompted: 설치 창이 닫힌 뒤(설치·취소 모두), onGuide: 가이드로 가기 직전에 부른다
  function start({
    onPrompted,
    onGuide,
  }: { onPrompted?: () => void; onGuide?: () => void } = {}) {
    const openGuide = () => {
      onGuide?.();
      router.push(
        `/install/${installPlatform(navigator.userAgent, navigator.maxTouchPoints)}`,
      );
    };
    if (canPrompt) {
      // 설치 창을 못 띄우면(브라우저가 거부) 메뉴 경로 안내로 간다
      promptInstall().then(() => onPrompted?.(), openGuide);
      return;
    }
    openGuide();
  }

  return { available: !inApp && !installed, canPrompt, start };
}
