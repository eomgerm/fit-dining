"use client";

import { useState } from "react";

import { Button } from "@/shared/ui/button/button";
import { IconButton } from "@/shared/ui/button/icon-button";
import { Avatar } from "@/shared/ui/display/avatar";
import { ChevronLeftIcon } from "@/shared/ui/icon/icons/chevron-left";
import { CopyIcon } from "@/shared/ui/icon/icons/copy";
import { InfoIcon } from "@/shared/ui/icon/icons/info";
import { MoreIcon } from "@/shared/ui/icon/icons/more";
import { ShareIcon } from "@/shared/ui/icon/icons/share";
import { TrashIcon } from "@/shared/ui/icon/icons/trash";
import { BottomBar } from "@/shared/ui/layout/bottom-bar";
import { Screen } from "@/shared/ui/layout/screen";
import { TopBar } from "@/shared/ui/layout/top-bar";
import { ConfirmDialog } from "@/shared/ui/overlay/confirm-dialog";
import { Menu, MenuItem } from "@/shared/ui/overlay/menu";

import {
  hostProfile,
  profileBadge,
  type MeetupProfile,
  type MeetupSnapshot,
} from "../model/meetup";
import { tasteSummary } from "../model/taste";
import { MeetupInfoCard, meetupTitle } from "./meetup-info-card";

function FriendRow({
  profile,
  mine,
  canEdit,
  canRemove,
  onEdit,
  onRemove,
}: {
  profile: MeetupProfile;
  mine: boolean;
  canEdit: boolean;
  canRemove: boolean;
  onEdit: () => void;
  onRemove: () => void;
}) {
  const summary = tasteSummary(profile.taste);
  return (
    <li className="flex items-center gap-3 py-2.5">
      <Avatar
        name={profile.name}
        color={profile.color}
        badge={profileBadge(profile)}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body-md text-ink">
          {profile.name}
          {mine && (
            <span className="ml-1 text-caption-sm text-ink-subtle">나</span>
          )}
        </span>
        <span className="text-caption-md text-ink-muted">
          {summary.length ? summary.join(" · ") : "모두 상관없어요"}
        </span>
      </div>
      {mine && canEdit && (
        <Button
          variant="outline"
          size="sm"
          aria-label="내 취향 수정"
          onClick={onEdit}
        >
          수정
        </Button>
      )}
      {!mine && canRemove && (
        <Menu
          trigger={
            <IconButton
              label={`${profile.name} 프로필 메뉴`}
              className="-mr-2.5"
            >
              <MoreIcon size="md" className="text-icon-subtle" />
            </IconButton>
          }
        >
          <MenuItem tone="danger" onClick={onRemove}>
            프로필 지우기
          </MenuItem>
        </Menu>
      )}
    </li>
  );
}

// 대기 화면(모임장 5, 참여자 6). 모임 정보, 링크 보내기, 취향을 남긴 친구 목록이다(AC-29, AC-34).
// 추천받기와 모임 정보 수정은 그 기능의 단계에서 붙인다
export function WaitingView({
  snapshot,
  onBack,
  onShare,
  onCopy,
  onEditTaste,
  onRemoveProfile,
  onPickName,
}: {
  snapshot: MeetupSnapshot;
  onBack?: () => void;
  onShare: () => void;
  onCopy: () => void;
  onEditTaste: () => void;
  onRemoveProfile: (profile: MeetupProfile) => void;
  // 프로필 없이 보는 사람이 이름을 고르러 간다
  onPickName?: () => void;
}) {
  const [removing, setRemoving] = useState<MeetupProfile>();
  const { me, info, profiles, allowed } = snapshot;
  const host = me.role === "HOST";
  const hostName = hostProfile(snapshot)?.name ?? info.hostNickname;
  const showOf =
    info.headcount !== undefined && profiles.length <= info.headcount;

  return (
    <Screen>
      <TopBar
        start={
          onBack && (
            <IconButton label="뒤로" onClick={onBack}>
              <ChevronLeftIcon className="text-icon" />
            </IconButton>
          )
        }
        title={meetupTitle(info)}
      />
      <div className="flex flex-col gap-7 px-5 pt-3 pb-4">
        {!host && (
          <p className="flex items-start gap-2 rounded-md bg-info-soft px-3.5 py-3 text-caption-md text-info">
            <InfoIcon size="sm" className="mt-px shrink-0" />
            <span>
              {hostName ? `${hostName}님이` : "모임장이"} 추천받으면 여기서 같이
              볼 수 있어요.
            </span>
          </p>
        )}
        <MeetupInfoCard info={info} />

        {host && (
          <section
            className="flex flex-col gap-3"
            aria-labelledby="share-title"
          >
            <div className="flex flex-col gap-1">
              <h2 id="share-title" className="text-title-md">
                친구에게 링크 보내기
              </h2>
              <p className="text-body-sm text-ink-muted">
                링크를 받은 사람은 남긴 취향을 볼 수 있어요.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="outline" size="md" onClick={onCopy}>
                <CopyIcon size="md" className="mr-1.5" />
                링크 복사
              </Button>
              <Button variant="outline" size="md" onClick={onShare}>
                <ShareIcon size="md" className="mr-1.5" />
                모임 링크 보내기
              </Button>
            </div>
          </section>
        )}

        <section
          className="flex flex-col gap-1"
          aria-labelledby="friends-title"
        >
          <h2 id="friends-title" className="text-title-md">
            취향을 남긴 친구{" "}
            <span className="text-primary">{profiles.length}</span>
            {showOf && (
              <span className="text-ink-subtle">/{info.headcount}</span>
            )}
          </h2>
          <ul>
            {profiles.map((profile) => (
              <FriendRow
                key={profile.id}
                profile={profile}
                mine={profile.id === me.profileId}
                canEdit={allowed.includes("EDIT_TASTE")}
                canRemove={allowed.includes("REMOVE_PROFILE")}
                onEdit={onEditTaste}
                onRemove={() => setRemoving(profile)}
              />
            ))}
            {snapshot.pendingCount !== undefined && (
              <li className="flex items-center gap-3 py-2.5">
                <span
                  aria-hidden="true"
                  className="size-9 shrink-0 rounded-full border-1.5 border-dashed border-line-strong"
                />
                <span className="text-body-md text-ink-subtle">
                  아직 {snapshot.pendingCount}명이 취향을 남기지 않았어요
                </span>
              </li>
            )}
          </ul>
        </section>
      </div>
      {!host && (
        <BottomBar>
          {onPickName ? (
            <Button onClick={onPickName}>내 이름 고르기</Button>
          ) : (
            <Button variant="outline" size="md" onClick={onShare}>
              모임 링크 보내기
            </Button>
          )}
        </BottomBar>
      )}
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(open) => {
          if (!open) setRemoving(undefined);
        }}
        tone="danger"
        icon={<TrashIcon />}
        title={`'${removing?.name ?? ""}' 프로필을 지울까요?`}
        description="이 이름으로 남긴 취향과 투표도 함께 지워져요. 실수로 두 번 만든 이름을 정리할 때 써요."
        secondaryAction={
          <Button
            variant="outline"
            size="md"
            onClick={() => setRemoving(undefined)}
          >
            취소
          </Button>
        }
        action={
          <Button
            variant="danger"
            size="md"
            onClick={() => {
              if (removing) onRemoveProfile(removing);
              setRemoving(undefined);
            }}
          >
            지우기
          </Button>
        }
      />
    </Screen>
  );
}
