import { Button } from "@/shared/ui/button/button";
import { UsersIcon } from "@/shared/ui/icon/icons/users";
import { BottomBar } from "@/shared/ui/layout/bottom-bar";
import { Screen } from "@/shared/ui/layout/screen";
import { TopBar } from "@/shared/ui/layout/top-bar";

// 다 찬 모임(예외 화면, AC-27). 프로필이 8개면 새로 참여할 수 없다
export function FullView({
  onPickName,
  onViewOnly,
}: {
  onPickName: () => void;
  onViewOnly: () => void;
}) {
  return (
    <Screen>
      <TopBar title="모임 장소 정하기" />
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 pb-20 text-center">
        <span
          aria-hidden="true"
          className="flex size-13 items-center justify-center rounded-full bg-surface-sunken text-icon"
        >
          <UsersIcon />
        </span>
        <h2 className="text-title-lg">모임 인원이 다 찼어요</h2>
        <p className="text-body-sm text-ink-muted">
          새로 참여할 수는 없어요.
          <br />
          이미 참여했다면 내 이름을 골라 주세요.
        </p>
      </div>
      <BottomBar>
        <Button onClick={onPickName}>내 이름 고르기</Button>
        <Button variant="outline" size="md" onClick={onViewOnly}>
          결과만 보기
        </Button>
      </BottomBar>
    </Screen>
  );
}
