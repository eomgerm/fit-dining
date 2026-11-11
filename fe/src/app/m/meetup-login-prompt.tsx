import { Button } from "@/shared/ui/button/button";
import { UsersIcon } from "@/shared/ui/icon/icons/users";
import { ConfirmDialog } from "@/shared/ui/overlay/confirm-dialog";

// 비회원이 모임을 만들려 할 때의 로그인 안내(모임장 2). "취소"는 들어오기 전 화면으로 돌아간다
export function MeetupLoginPrompt({
  open,
  onCancel,
  onSignIn,
}: {
  open: boolean;
  onCancel: () => void;
  onSignIn: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      icon={<UsersIcon />}
      title="로그인이 필요해요"
      description={
        <>
          모임은 로그인해야 만들 수 있어요.
          <br />
          친구들은 가입 없이 참여해요.
        </>
      }
      secondaryAction={
        <Button variant="outline" size="md" onClick={onCancel}>
          취소
        </Button>
      }
      action={
        <Button size="md" onClick={onSignIn}>
          로그인
        </Button>
      }
    />
  );
}
