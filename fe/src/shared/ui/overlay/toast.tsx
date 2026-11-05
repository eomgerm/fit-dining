"use client";

import { Toast } from "@base-ui/react/toast";
import type { ReactNode } from "react";

// Figma 'Toast'. 화면 아래 96px 위 가운데에 잠깐 떴다 사라지는 한 줄 알림.
// 아래 고정 버튼(BottomBar)이 홈 인디케이터만큼 높아지는 기기에서는 그만큼 같이 올라가 버튼과의 간격을 지킨다.
// 모션 메모: 16px 아래에서 떠오르며 200ms, 2.5초 뒤 150ms에 사라진다. 한 번에 하나만 보인다
export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <Toast.Provider timeout={2500} limit={1}>
      {children}
      <Toast.Portal>
        {/* 다이얼로그·시트의 딤은 나중에 body에 붙어 토스트를 덮으므로 z-index로 위에 둔다 */}
        <Toast.Viewport className="fixed inset-x-4 bottom-toast z-10 flex justify-center">
          <ToastList />
        </Toast.Viewport>
      </Toast.Portal>
    </Toast.Provider>
  );
}

function ToastList() {
  const { toasts } = Toast.useToastManager();
  return toasts.map((toast) => (
    <Toast.Root
      key={toast.id}
      toast={toast}
      // 끌어서 닫을 때 손가락을 따라 움직이도록 Base UI의 swipe 변수를 쓴다
      className="absolute bottom-0 flex min-h-10 max-w-full translate-x-(--toast-swipe-movement-x) translate-y-(--toast-swipe-movement-y) items-center rounded-xl bg-ink px-4 py-2 text-surface shadow-2 transition duration-200 ease-enter data-ending-style:opacity-0 data-ending-style:duration-150 data-ending-style:ease-exit data-limited:opacity-0 data-starting-style:translate-y-4 data-starting-style:opacity-0 data-swiping:duration-0 motion-reduce:duration-120 motion-reduce:data-ending-style:duration-120 motion-reduce:data-starting-style:translate-y-0"
    >
      {/* 문구의 \n에서 줄을 나눈다. 한 줄이면 rounded-xl이 알약 모양이 된다(4-E01) */}
      <Toast.Description className="text-center text-body-sm whitespace-pre-line" />
    </Toast.Root>
  ));
}

// 화면에서 const toast = useToast(); toast("리뷰를 삭제했어요")처럼 쓴다
export function useToast() {
  const { add } = Toast.useToastManager();
  return (message: string) => add({ description: message });
}
