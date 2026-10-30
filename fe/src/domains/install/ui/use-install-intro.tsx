"use client";

import { useRef, useState } from "react";
import { introSeen, markIntroSeen } from "../model/storage";
import { InstallIntroDialog } from "./install-intro-dialog";
import { useInstall } from "./use-install";

// 1-01a 흐름. 브라우저에서 처음 화면의 버튼을 처음 누를 때 한 번만 안내를 띄우고,
// [웹에서 계속하기]면 그 버튼이 하던 일을 이어 간다
export function useInstallIntro() {
  const { available, start } = useInstall();
  const [open, setOpen] = useState(false);
  const proceed = useRef<() => void>(undefined);

  function intercept(_from: "start" | "login", next: () => void) {
    if (!available || introSeen()) return false;
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
        start();
      }}
      onContinue={() => {
        close();
        proceed.current?.();
      }}
    />
  );

  return { intercept, dialog };
}
