import { Button } from "@/shared/ui/button/button";
import { BookmarkIcon } from "@/shared/ui/icon/icons/bookmark";
import { ConfirmDialog } from "@/shared/ui/overlay/confirm-dialog";

export const SAVE_LOGIN_MESSAGE = "장소 저장은 로그인해야 이용할 수 있어요.";
export const SAVED_LOGIN_MESSAGE = "저장한 장소는 로그인해야 볼 수 있어요.";

// 북마크의 로그인 안내(와이어프레임 StartGuest, D-7). [취소]는 요청 없이 닫고 [로그인]은 로그인 화면으로 간다
export function LoginPrompt({
  open,
  description,
  onCancel,
  onLogin,
}: {
  open: boolean;
  description: string;
  onCancel: () => void;
  onLogin: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      icon={<BookmarkIcon />}
      title="로그인이 필요해요"
      description={description}
      secondaryAction={
        <Button variant="outline" size="md" onClick={onCancel}>
          취소
        </Button>
      }
      action={
        <Button size="md" onClick={onLogin}>
          로그인
        </Button>
      }
    />
  );
}
