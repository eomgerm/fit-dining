import type { ReactNode } from "react";

import { DialogFrame, type DialogContentProps } from "@/shared/ui/dialog";

type ConfirmDialogProps = DialogContentProps & {
  // 주 버튼. 항상 오른쪽에 둔다(예: <Button variant="danger" size="md">삭제</Button>)
  action: ReactNode;
  // 보조 버튼(취소·닫기·나가기). 항상 왼쪽에 둔다(예: <Button variant="outline" size="md">)
  secondaryAction: ReactNode;
};

// Figma 'Dialog' Actions=2. 두 가지 중 하나를 고르게 하는 창. 주 버튼은 오른쪽으로 통일한다
export function ConfirmDialog({
  action,
  secondaryAction,
  ...props
}: ConfirmDialogProps) {
  return (
    <DialogFrame
      actions={
        <>
          {secondaryAction}
          {action}
        </>
      }
      {...props}
    />
  );
}
