import type { ReactNode } from "react";

import { DialogFrame, type DialogContentProps } from "@/shared/ui/dialog";

type AlertDialogProps = DialogContentProps & {
  // 버튼 하나. 창 폭을 꽉 채운다(예: <Button size="md">확인</Button>)
  action: ReactNode;
};

// Figma 'Dialog' Actions=1. 알리고 확인만 받는 창
export function AlertDialog({ action, ...props }: AlertDialogProps) {
  return <DialogFrame actions={action} {...props} />;
}
