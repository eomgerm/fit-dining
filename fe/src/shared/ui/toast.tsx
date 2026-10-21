"use client";

import { Toast } from "@base-ui/react/toast";
import type { ReactNode } from "react";

// Figma 'Toast'. 화면 아래 96px 위 가운데에 잠깐 떴다 사라지는 한 줄 알림.
// 모션 메모: 16px 아래에서 떠오르며 200ms, 2.5초 뒤 150ms에 사라진다. 한 번에 하나만 보인다
export function ToastProvider({ children }: { children: ReactNode }) {
  return (
    <Toast.Provider timeout={2500} limit={1}>
      {children}
      <Toast.Portal>
        <Toast.Viewport className="fixed inset-x-0 bottom-24 flex justify-center">
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
      className="absolute bottom-0 flex h-10 items-center rounded-full bg-ink px-4 whitespace-nowrap text-surface shadow-2 transition duration-200 ease-enter data-ending-style:opacity-0 data-ending-style:duration-150 data-ending-style:ease-exit data-limited:opacity-0 data-starting-style:translate-y-4 data-starting-style:opacity-0 motion-reduce:translate-y-0 motion-reduce:transition-opacity"
    >
      <Toast.Description className="text-body-sm" />
    </Toast.Root>
  ));
}

// 화면에서 const toast = useToast(); toast("리뷰를 삭제했어요")처럼 쓴다
export function useToast() {
  const { add } = Toast.useToastManager();
  return (message: string) => add({ description: message });
}
