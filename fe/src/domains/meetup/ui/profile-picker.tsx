"use client";

import { Avatar, AvatarBadgeMark } from "@/shared/ui/display/avatar";
import { InfoIcon } from "@/shared/ui/icon/icons/info";
import { PlusIcon } from "@/shared/ui/icon/icons/plus";
import { Screen } from "@/shared/ui/layout/screen";
import { TopBar } from "@/shared/ui/layout/top-bar";

import {
  profileBadge,
  type MeetupProfile,
  type MeetupSnapshot,
} from "../model/meetup";
import { MeetupInfoCard } from "./meetup-info-card";

// 프로필 고르기(참여자 2, AC-26). 모임 정보, 이름 목록, "처음 왔어요", 배지 설명, "결과만 보기"다
export function ProfilePicker({
  snapshot,
  onPick,
  onJoin,
  onViewOnly,
}: {
  snapshot: MeetupSnapshot;
  onPick: (profile: MeetupProfile) => void;
  onJoin: () => void;
  onViewOnly: () => void;
}) {
  return (
    <Screen>
      <TopBar title="모임 장소 정하기" />
      <div className="flex flex-1 flex-col gap-6 px-5 pt-4">
        <MeetupInfoCard info={snapshot.info} showHost />
        <section className="flex flex-col gap-4" aria-labelledby="pick-title">
          <div className="flex flex-col gap-1">
            <h2 id="pick-title" className="text-headline-md">
              내 이름을 골라 주세요
            </h2>
            <p className="text-body-sm text-ink-muted">
              처음이면 &apos;처음 왔어요&apos;를 눌러 주세요. 다음부터는 바로
              들어갈 수 있어요.
            </p>
          </div>
          <ul className="grid grid-cols-4 gap-2">
            {snapshot.profiles.map((profile) => (
              <li key={profile.id}>
                <button
                  type="button"
                  onClick={() => onPick(profile)}
                  className="flex w-full flex-col items-center gap-1.5 py-2 transition motion-safe:active:scale-98"
                >
                  <Avatar
                    name={profile.name}
                    color={profile.color}
                    size="xl"
                    badge={profileBadge(profile)}
                  />
                  <span className="max-w-full truncate text-label-md">
                    {profile.name}
                  </span>
                  <span className="text-caption-sm text-ink-subtle">
                    참여했어요
                  </span>
                </button>
              </li>
            ))}
            <li>
              <button
                type="button"
                onClick={onJoin}
                className="flex w-full flex-col items-center gap-1.5 py-2 transition motion-safe:active:scale-98"
              >
                <span className="flex size-16 items-center justify-center rounded-full border-1.5 border-dashed border-icon-subtle text-icon">
                  <PlusIcon />
                </span>
                <span className="text-label-md">처음 왔어요</span>
                <span className="text-caption-sm text-ink-subtle">
                  새로 참여
                </span>
              </button>
            </li>
          </ul>
          <div className="flex items-start gap-2 rounded-md bg-surface-sunken px-3.5 py-3 text-caption-md text-ink-muted">
            <InfoIcon size="sm" className="mt-px shrink-0" />
            <p>
              <AvatarBadgeMark kind="host" placement="inline" /> 모임장 ·{" "}
              <AvatarBadgeMark kind="member" placement="inline" /> 회원
              <br />
              회원 프로필은 로그인해야 들어갈 수 있어요
            </p>
          </div>
        </section>
      </div>
      <div className="flex justify-center px-5 pt-2 pb-safe-4">
        <button
          type="button"
          onClick={onViewOnly}
          className="h-11 px-3 text-label-md text-ink"
        >
          결과만 보기
        </button>
      </div>
    </Screen>
  );
}
