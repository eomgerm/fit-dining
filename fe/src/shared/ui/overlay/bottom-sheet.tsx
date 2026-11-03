import { Drawer } from "@base-ui/react/drawer";
import type { ReactNode } from "react";

type BottomSheetProps = Omit<Drawer.Root.Props, "children"> & {
  // 시트 이름. 화면 낭독기가 시트를 이 이름으로 읽는다
  title: ReactNode;
  children: ReactNode;
  // 닫힐 때 포커스를 보낼 곳. 없으면 연 버튼으로 돌아간다(예: 그 버튼이 목록에서 빠질 때)
  finalFocus?: Drawer.Popup.Props["finalFocus"];
};

// Figma 'Bottom sheet header' Type=Title을 쓰는 모달 시트(약관 동의, 신고 사유, 방문일 고르기 등).
// Base UI Drawer라 끌어 내리거나 배경을 누르면 닫힌다.
// 모션 메모: 아래에서 올라오고 배경도 같은 시간에 어두워진다(320ms). 닫힐 때 220ms
export function BottomSheet({
  title,
  children,
  finalFocus,
  ...props
}: BottomSheetProps) {
  return (
    <Drawer.Root {...props}>
      <Drawer.Portal>
        <Drawer.Backdrop className="fixed inset-0 bg-scrim transition-opacity duration-320 ease-enter data-ending-style:opacity-0 data-ending-style:duration-220 data-ending-style:ease-exit data-starting-style:opacity-0 data-swiping:duration-0 motion-reduce:duration-120 motion-reduce:data-ending-style:duration-120" />
        <Drawer.Viewport className="fixed inset-0 flex items-end">
          <Drawer.Popup
            finalFocus={finalFocus}
            className="flex max-h-4/5 w-full translate-y-(--drawer-swipe-movement-y) flex-col rounded-t-xl bg-surface px-5 pb-safe-5 shadow-sheet transition-transform duration-320 ease-enter outline-none data-ending-style:translate-y-full data-ending-style:duration-220 data-ending-style:ease-exit data-starting-style:translate-y-full data-swiping:duration-0 data-swiping:select-none motion-reduce:transition-opacity motion-reduce:duration-120 motion-reduce:data-ending-style:translate-y-0 motion-reduce:data-ending-style:opacity-0 motion-reduce:data-ending-style:duration-120 motion-reduce:data-starting-style:translate-y-0 motion-reduce:data-starting-style:opacity-0"
          >
            <div className="mx-auto mt-2 h-1 w-9 shrink-0 rounded-full bg-line-strong" />
            <Drawer.Content className="mt-3 flex min-h-0 flex-col overflow-y-auto overscroll-contain">
              <Drawer.Title className="text-title-lg text-ink">
                {title}
              </Drawer.Title>
              <div className="mt-4">{children}</div>
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
