"use client";

import { useState } from "react";

import { Button } from "@/shared/ui/button/button";
import { ConfirmDialog } from "@/shared/ui/overlay/confirm-dialog";
import { useToast } from "@/shared/ui/overlay/toast";

import { conflictOf, useLinkAccount, type WithSession } from "../api/queries";
import { markLinkAsked, wasLinkAsked } from "../model/link-asked";
import type { MeetupSnapshot } from "../model/meetup";
import { KeepWords } from "./keep-words";

// 로그인한 회원에게 자기 프로필이 없고 이 브라우저의 비회원 프로필로 들어왔을 때, 회원 프로필로 바꿀지 한 번 묻는다
// (D-25, AC-68). 남긴 모임 취향은 그대로다. 화면 예시에 없는 안내라 문구는 D-35에 남긴다
export function LinkAccountDialog({
  code,
  snapshot,
  withSession,
}: {
  code: string;
  snapshot: MeetupSnapshot;
  withSession: WithSession;
}) {
  const toast = useToast();
  const link = useLinkAccount(code, withSession);
  const [dismissed, setDismissed] = useState(() => wasLinkAsked(code));
  const eligible =
    !!snapshot.me.convertible && snapshot.allowed.includes("LINK_ACCOUNT");
  const name = snapshot.profiles.find(
    (profile) => profile.id === snapshot.me.profileId,
  )?.name;

  const close = () => {
    markLinkAsked(code);
    setDismissed(true);
  };

  const confirm = () =>
    link.mutate(undefined, {
      onSuccess: () => toast("회원 프로필로 바꿨어요"),
      onError: (error) =>
        toast(
          conflictOf(error) === "already-joined"
            ? "이미 이 모임에 내 프로필이 있어요"
            : "바꾸지 못했어요. 잠시 뒤 다시 시도해 주세요.",
        ),
      onSettled: close,
    });

  return (
    <ConfirmDialog
      open={eligible && !dismissed}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      title="회원 프로필로 바꿀까요?"
      description={
        <KeepWords>
          {name ? `${name}님 프로필을` : "이 프로필을"} 지금 로그인한 계정으로
          이어 써요. 남긴 취향은 그대로이고, 다음부터는 로그인하면 바로
          들어와요.
        </KeepWords>
      }
      secondaryAction={
        <Button variant="outline" size="md" onClick={close}>
          나중에
        </Button>
      }
      action={
        <Button size="md" disabled={link.isPending} onClick={confirm}>
          바꾸기
        </Button>
      }
    />
  );
}
