"use client";

import { Button } from "@/shared/ui/button/button";
import { Avatar } from "@/shared/ui/display/avatar";
import { UserIcon } from "@/shared/ui/icon/icons/user";
import { UsersIcon } from "@/shared/ui/icon/icons/users";
import { ConfirmDialog } from "@/shared/ui/overlay/confirm-dialog";

import type { MeetupProfile } from "../model/meetup";
import { KeepWords } from "./keep-words";

// 다른 브라우저에서 비회원 이름을 골랐을 때(참여자 3)
export function ConfirmProfileDialog({
  profile,
  pending,
  onCancel,
  onConfirm,
}: {
  profile?: MeetupProfile;
  pending: boolean;
  onCancel: () => void;
  onConfirm: (profile: MeetupProfile) => void;
}) {
  return (
    <ConfirmDialog
      open={!!profile}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      title={
        <span className="flex flex-col items-center gap-3">
          {profile && (
            <Avatar name={profile.name} color={profile.color} size="lg" />
          )}
          {profile?.name}님이 맞나요?
        </span>
      }
      description={
        <KeepWords>맞으면 {profile?.name}님으로 들어가요.</KeepWords>
      }
      secondaryAction={
        <Button variant="outline" size="md" onClick={onCancel}>
          아니에요
        </Button>
      }
      action={
        <Button
          size="md"
          disabled={pending}
          onClick={() => profile && onConfirm(profile)}
        >
          맞아요
        </Button>
      }
    />
  );
}

// 로그인하지 않고 회원 이름을 골랐을 때(상태 모음 2, AC-26)
export function MemberProfileDialog({
  profile,
  onCancel,
  onSignIn,
}: {
  profile?: MeetupProfile;
  onCancel: () => void;
  onSignIn: () => void;
}) {
  return (
    <ConfirmDialog
      open={!!profile}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
      icon={<UserIcon />}
      title="로그인이 필요해요"
      description={
        <KeepWords>
          {profile?.name}님은 회원으로 참여했어요. 로그인하면 바로 들어갈 수
          있어요.
        </KeepWords>
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

// 정한 인원만큼 이미 참여했는데 "처음 왔어요"를 눌렀을 때 한 번 묻는다(상태 모음 2, AC-26)
export function JoinAgainDialog({
  open,
  count,
  onPickName,
  onJoin,
}: {
  open: boolean;
  count: number;
  onPickName: () => void;
  onJoin: () => void;
}) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onPickName();
      }}
      icon={<UsersIcon />}
      title={`이미 ${count}명이 참여했어요`}
      description={
        <KeepWords>
          목록에 내 이름이 있다면 그 이름을 골라 주세요. 두 번 참여하면 추천이
          달라질 수 있어요.
        </KeepWords>
      }
      secondaryAction={
        <Button variant="outline" size="md" onClick={onPickName}>
          이름 고르기
        </Button>
      }
      action={
        <Button size="md" onClick={onJoin}>
          처음 왔어요
        </Button>
      }
    />
  );
}
