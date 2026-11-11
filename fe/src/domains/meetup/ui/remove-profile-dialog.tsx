"use client";

import { Button } from "@/shared/ui/button/button";
import { TrashIcon } from "@/shared/ui/icon/icons/trash";
import { ConfirmDialog } from "@/shared/ui/overlay/confirm-dialog";

import type { MeetupProfile } from "../model/meetup";
import { KeepWords } from "./keep-words";

// 모임장이 다른 사람의 프로필을 지우기 전에 한 번 묻는다(AC-30). 대기 화면과 친구들 취향에서 쓴다
export function RemoveProfileDialog({
  profile,
  onClose,
  onRemove,
}: {
  profile?: MeetupProfile;
  onClose: () => void;
  onRemove: (profile: MeetupProfile) => void;
}) {
  return (
    <ConfirmDialog
      open={!!profile}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      tone="danger"
      icon={<TrashIcon />}
      title={`'${profile?.name ?? ""}' 프로필을 지울까요?`}
      description={
        <KeepWords>
          이 이름으로 남긴 취향과 투표도 함께 지워져요. 실수로 두 번 만든 이름을
          정리할 때 써요.
        </KeepWords>
      }
      secondaryAction={
        <Button variant="outline" size="md" onClick={onClose}>
          취소
        </Button>
      }
      action={
        <Button
          variant="danger"
          size="md"
          onClick={() => {
            if (profile) onRemove(profile);
            onClose();
          }}
        >
          지우기
        </Button>
      }
    />
  );
}
