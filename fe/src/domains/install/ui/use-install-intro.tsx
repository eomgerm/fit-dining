"use client";

import { startTransition, useRef, useState } from "react";
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
  const { available, canPrompt, start } = useInstall();
  const [open, setOpen] = useState(false);
  const from = useRef<IntroAction>("start");
  const proceed = useRef<() => void>(undefined);
  const afterClosed = useRef<() => void>(undefined);

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
        const install = () =>
          start({
            onPrompted: () => proceed.current?.(),
            onGuide: () => {
              // 가이드 화면에서 새로고침해 이 화면이 새로 그려져도 이어 가도록 남긴다
              rememberResume(from.current);
              // 떠난 화면은 상태째 남았다가 뒤로 가기에 그대로 다시 보인다(Cache Components).
              // 가이드로 가는 전환에 함께 실어 가이드가 그려질 때 이미 온보딩이 되어 있게 한다.
              // 돌아온 뒤 바꾸면 최초화면(어두운 영상)이 비쳤다 바뀌어 깜빡인다
              if (from.current === "start")
                startTransition(() => proceed.current?.());
            },
          });
        // 설치 창은 누른 직후(사용자 동작 안)에 띄워야 한다. 가이드는 창이 다 닫힌 뒤에 간다.
        // 닫히는 도중에 떠나면 닫히다 만 창이 보존된 화면에 남아 돌아올 때 한 프레임 비친다
        if (canPrompt) install();
        else afterClosed.current = install;
      }}
      onClosed={() => {
        afterClosed.current?.();
        afterClosed.current = undefined;
      }}
      onContinue={() => {
        close();
        proceed.current?.();
      }}
    />
  );

  return { intercept, dialog };
}
