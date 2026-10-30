"use client";

import { useRef, useState } from "react";
import {
  introSeen,
  markIntroSeen,
  rememberResume,
  type IntroAction,
} from "../model/storage";
import { InstallIntroDialog } from "./install-intro-dialog";
import { useInstall } from "./use-install";

// 1-01a 흐름. 브라우저에서 처음 화면의 버튼을 처음 누를 때 한 번만 안내를 띄운다.
// 안내가 끝나면(웹에서 계속·설치 창 닫힘·가이드에서 돌아옴) 최초화면에 머물지 않고 그 버튼이 하던 일을 이어 간다
export function useInstallIntro() {
  const { available, start } = useInstall();
  const [open, setOpen] = useState(false);
  const from = useRef<IntroAction>("start");
  const proceed = useRef<() => void>(undefined);

  function intercept(action: IntroAction, next: () => void) {
    if (!available || introSeen()) return false;
    from.current = action;
    proceed.current = next;
    setOpen(true);
    return true;
  }
  // 닫을 때 본 것으로 기록한다. 띄울 때 기록하면 모달 뒤에 배너(4-01b)가 함께 뜬다
  function close() {
    markIntroSeen();
    setOpen(false);
  }

  const dialog = (
    <InstallIntroDialog
      open={open}
      onInstall={() => {
        close();
        start({
          onPrompted: () => proceed.current?.(),
          // 가이드는 다른 화면이라 돌아왔을 때 HomeEntry가 이어 가도록 남긴다
          onGuide: () => rememberResume(from.current),
        });
      }}
      onContinue={() => {
        close();
        proceed.current?.();
      }}
    />
  );

  return { intercept, dialog };
}
