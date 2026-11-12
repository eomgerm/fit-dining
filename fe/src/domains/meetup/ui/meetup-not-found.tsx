import Link from "next/link";

import { ClockIcon } from "@/shared/ui/icon/icons/clock";
import { BottomBar } from "@/shared/ui/layout/bottom-bar";
import { Screen } from "@/shared/ui/layout/screen";
import { TopBar } from "@/shared/ui/layout/top-bar";

// 없거나 끝난 모임(예외 화면, AC-65). 처음부터 없던 링크와 닫혀서 지운 모임을 한 문구로 덮고 모임 정보는 보이지 않는다
export function MeetupNotFound() {
  return (
    <Screen>
      <TopBar title="모임 장소 정하기" />
      <div className="flex flex-1 flex-col items-center justify-center gap-3 px-8 pb-20 text-center">
        <span
          aria-hidden="true"
          className="flex size-13 items-center justify-center rounded-full bg-surface-sunken text-icon"
        >
          <ClockIcon />
        </span>
        <h2 className="text-title-lg">없거나 지워진 모임이에요</h2>
        <p className="text-body-sm text-ink-muted">
          모임장이 탈퇴하면 모임이 사라져요.
        </p>
      </div>
      <BottomBar>
        <Link
          href="/"
          className="inline-flex h-14 items-center justify-center rounded-md bg-primary px-6 text-button-lg text-on-primary"
        >
          핏다이닝 둘러보기
        </Link>
      </BottomBar>
    </Screen>
  );
}
