"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import Image from "next/image";
import { Button } from "@/shared/ui/button/button";
import { TextButton } from "@/shared/ui/button/text-button";

type InstallIntroDialogProps = {
  open: boolean;
  onInstall: () => void;
  // 누른 버튼의 원래 화면(온보딩·로그인)으로 간다
  onContinue: () => void;
  // 닫힘 애니메이션까지 끝난 뒤
  onClosed?: () => void;
};

// 1-01a 최초화면 홈 화면 추가 안내. 화면 아래에 붙는 창이라 Base UI AlertDialog에 바텀시트 모션을 쓴다.
// 모션 메모: 아래에서 올라오고 배경도 같은 시간에 어두워진다(320ms). 닫힐 때 220ms
export function InstallIntroDialog({
  open,
  onInstall,
  onContinue,
  onClosed,
}: InstallIntroDialogProps) {
  return (
    <AlertDialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onContinue();
      }}
      onOpenChangeComplete={(next) => {
        if (!next) onClosed?.();
      }}
    >
      <AlertDialog.Portal>
        <AlertDialog.Backdrop className="fixed inset-0 bg-scrim transition-opacity duration-320 ease-enter data-ending-style:opacity-0 data-ending-style:duration-220 data-ending-style:ease-exit data-starting-style:opacity-0 motion-reduce:duration-120 motion-reduce:data-ending-style:duration-120" />
        <AlertDialog.Popup className="fixed inset-x-4 bottom-safe-4 mx-auto flex max-w-102 flex-col items-center gap-3 rounded-xl bg-surface px-5 pt-6 pb-5 text-center shadow-3 transition duration-320 ease-enter outline-none data-ending-style:translate-y-full data-ending-style:duration-220 data-ending-style:ease-exit data-starting-style:translate-y-full motion-reduce:transition-opacity motion-reduce:duration-120 motion-reduce:data-ending-style:translate-y-0 motion-reduce:data-ending-style:opacity-0 motion-reduce:data-starting-style:translate-y-0 motion-reduce:data-starting-style:opacity-0">
          <Image src="/icons/icon-192.png" alt="" width={56} height={56} />
          <AlertDialog.Title className="text-title-lg text-ink">
            홈 화면에{" "}
            <Image
              src="/brand/fitdining.svg"
              alt="핏다이닝"
              width={82}
              height={24}
              className="inline-block align-middle"
            />
            을 추가하면
            <br />
            편리하게 사용할 수 있어요!
          </AlertDialog.Title>
          <Button size="md" className="mt-2 w-full" onClick={onInstall}>
            홈 화면에 추가하기
          </Button>
          <TextButton variant="muted" onClick={onContinue}>
            웹에서 계속하기
          </TextButton>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
