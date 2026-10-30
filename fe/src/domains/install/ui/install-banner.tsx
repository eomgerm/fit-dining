"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
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

// 4-01b 홈 화면 추가 배너. 1-01a 모달을 본 뒤로 브라우저로 연 모든 화면 맨 위에 띄운다.
// 페이지 배치를 밀지 않고 위에 떠 있어, 닫기 전까지는 화면 맨 위 48px(상단 바·지도 버튼)를 덮는다
export function InstallBanner() {
  const pathname = usePathname();
  const { available, start } = useInstall();
  const waiting = useSyncExternalStore(
    subscribeInstallStorage,
    () => introSeen() && !bannerClosed(),
    () => false,
  );
  // 가이드 화면은 그 자체가 안내라 띄우지 않는다
  if (!available || !waiting || pathname.startsWith("/install")) return null;
  return (
    <aside
      aria-label="홈 화면 추가 안내"
      className="fixed inset-x-0 top-0 flex h-12 items-center gap-2 bg-ink pl-3 text-label-md text-surface"
    >
      <Image
        src="/icons/icon-192.png"
        alt=""
        width={32}
        height={32}
        className="shrink-0"
      />
      <span className="min-w-0 flex-1">홈 화면에 추가하고 편리하게 사용</span>
      <Button size="sm" className="shrink-0" onClick={start}>
        추가하기
      </Button>
      {/* 글이 두 줄로 넘어가지 않게 닫기 버튼을 [추가하기]에 붙인다 */}
      <IconButton label="배너 닫기" className="-ml-2" onClick={closeBanner}>
        <CloseIcon className="text-surface" />
      </IconButton>
    </aside>
  );
}
