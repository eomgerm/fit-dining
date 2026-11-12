"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useSyncExternalStore } from "react";
import { Button } from "@/shared/ui/button/button";
import { IconButton } from "@/shared/ui/button/icon-button";
import { CloseIcon } from "@/shared/ui/icon/icons/close";
import {
  bannerClosed,
  closeBanner,
  introSeen,
  subscribeInstallStorage,
} from "../model/storage";
import { useInstall } from "./use-install";

// 4-01 첫 화면 전 흐름(로그인·회원가입·위치 권한)과 가이드(그 자체가 안내)에서는 띄우지 않는다
const beforeHome = ["/login", "/signup", "/location", "/install"];

// 첫 화면과 주소(/)가 같은 최초화면·온보딩이 떠 있는 동안 배너를 숨긴다
let hidden = 0;
const hiddenListeners = new Set<() => void>();
function setHidden(delta: number) {
  hidden += delta;
  hiddenListeners.forEach((listener) => listener());
}
function subscribeHidden(listener: () => void) {
  hiddenListeners.add(listener);
  return () => {
    hiddenListeners.delete(listener);
  };
}
// 그리기 전에 숨겨야 화면이 되살아날 때 배너가 한 프레임 비치지 않는다
export function useHideInstallBanner(active: boolean) {
  useLayoutEffect(() => {
    if (!active) return;
    setHidden(1);
    return () => setHidden(-1);
  }, [active]);
}

// 4-01b 홈 화면 추가 배너. 1-01a 모달을 본 뒤로 4-01 첫 화면부터의 브라우저 화면 맨 위(safe area 아래)에 띄운다.
// 페이지 배치를 밀지 않고 위에 떠 있어, 그 아래 48px를 덮는다. 보이는 동안 <html>에 data-install-banner를 달아
// 위쪽 요소(top-safe-*, pt-safe-*)가 CSS(globals.css의 --install-banner-height)로 배너 아래에 서게 한다
export function InstallBanner() {
  const pathname = usePathname();
  const { available, start } = useInstall();
  const waiting = useSyncExternalStore(
    subscribeInstallStorage,
    () => introSeen() && !bannerClosed(),
    () => false,
  );
  const hiddenByScreen = useSyncExternalStore(
    subscribeHidden,
    () => hidden > 0,
    () => true,
  );
  const visible =
    available &&
    waiting &&
    !hiddenByScreen &&
    !beforeHome.some((path) => pathname.startsWith(path));
  // 그리기 전에 달아야 배너가 뜨는 프레임에 위쪽 요소도 같이 내려간다
  useLayoutEffect(() => {
    if (!visible) return;
    document.documentElement.setAttribute("data-install-banner", "");
    return () =>
      document.documentElement.removeAttribute("data-install-banner");
  }, [visible]);
  if (!visible) return null;
  return (
    <aside
      aria-label="홈 화면 추가 안내"
      className="fixed inset-x-0 top-statusbar-0 flex h-12 items-center gap-2 bg-ink pl-3 text-label-md text-surface"
    >
      <Image
        src="/icons/icon-192.png"
        alt=""
        width={32}
        height={32}
        className="shrink-0"
      />
      <span className="min-w-0 flex-1">홈 화면에 추가하고 편리하게 사용</span>
      <Button
        size="sm"
        className="shrink-0"
        onClick={() => {
          // 눌렀으면 할 일을 다 한 배너라 이번 방문 동안 숨긴다
          closeBanner();
          start();
        }}
      >
        추가하기
      </Button>
      {/* 글이 두 줄로 넘어가지 않게 닫기 버튼을 [추가하기]에 붙인다 */}
      <IconButton label="배너 닫기" className="-ml-2" onClick={closeBanner}>
        <CloseIcon className="text-surface" />
      </IconButton>
    </aside>
  );
}
