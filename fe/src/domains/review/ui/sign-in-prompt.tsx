import { Button } from "@/shared/ui/button/button";
import { UserIcon } from "@/shared/ui/icon/icons/user";
import { ConfirmDialog } from "@/shared/ui/overlay/confirm-dialog";

// 로그인하지 않은 사용자에게 띄우는 로그인 안내(Figma 6-E05, D-47). "취소"는 창만 닫는다
export function SignInPrompt({
  open,
  description,
  onClose,
  onSignIn,
}: {
  open: boolean;
  description: string;
  onClose: () => void;
  onSignIn: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      icon={<UserIcon />}
      title="로그인이 필요해요"
      description={description}
      secondaryAction={
        <Button variant="outline" size="md" onClick={onClose}>
          취소
        </Button>
      }
      action={
        <Button
          size="md"
          onClick={() => {
            onClose();
            onSignIn();
          }}
        >
          로그인
        </Button>
      }
    />
  );
}
