import Link from "next/link";

import { UsersIcon } from "@/shared/ui/icon/icons/users";

// 홈 지도 왼쪽 위의 모임 시작 버튼(화면 예시 모임장 1, meetup AC-67). 내 모임(/m)으로 간다(AC-75)
export function MeetupStartButton() {
  return (
    <Link
      href="/m"
      className="inline-flex h-10 items-center gap-1.5 rounded-full bg-surface pr-3.5 pl-3 text-label-md text-ink shadow-2 transition select-none motion-safe:active:scale-97"
    >
      <UsersIcon size="md" className="text-primary" />
      모임 장소 정하기
    </Link>
  );
}
