"use client";

import { useState } from "react";

import { Button } from "@/shared/ui/button/button";
import { IconButton } from "@/shared/ui/button/icon-button";
import { Avatar } from "@/shared/ui/display/avatar";
import { MoreIcon } from "@/shared/ui/icon/icons/more";
import { BottomSheet } from "@/shared/ui/overlay/bottom-sheet";
import { Menu, MenuItem } from "@/shared/ui/overlay/menu";

import {
  profileBadge,
  type MeetupProfile,
  type MeetupSnapshot,
} from "../model/meetup";
import { tasteRows } from "../model/taste";
import { RemoveProfileDialog } from "./remove-profile-dialog";

// 결과 뒤의 친구들 취향(참여자 8). 추천에 반영되지 않은 취향을 알리고, 모임장은 다른 사람 줄의 ⋯ 메뉴로 프로필을 지운다(AC-30)
export function FriendsSheet({
  open,
  onOpenChange,
  snapshot,
  onEditTaste,
  onRemoveProfile,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: MeetupSnapshot;
  onEditTaste: () => void;
  onRemoveProfile: (profile: MeetupProfile) => void;
}) {
  const [removing, setRemoving] = useState<MeetupProfile>();
  const { me, profiles, allowed } = snapshot;
  const hasResult = snapshot.resultCalculationId !== undefined;

  return (
    <>
      <BottomSheet
        open={open}
        onOpenChange={onOpenChange}
        title={
          <>
            친구들 취향{" "}
            <span className="text-ink-subtle">{profiles.length}</span>
          </>
        }
      >
        <ul className="flex flex-col">
          {profiles.map((profile) => {
            const mine = profile.id === me.profileId;
            return (
              <li
                key={profile.id}
                className="flex gap-3 border-b border-line py-3 last:border-b-0"
              >
                <Avatar
                  name={profile.name}
                  color={profile.color}
                  badge={profileBadge(profile)}
                />
                <div className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className="text-title-sm text-ink">
                    {profile.name}{" "}
                    <span className="text-caption-sm font-normal text-ink-muted">
                      {mine
                        ? "나"
                        : profile.member && !profile.host
                          ? "평소 취향도 반영돼요"
                          : null}
                    </span>
                  </span>
                  {hasResult && !profile.reflected && (
                    <span className="text-label-sm text-warning">
                      아직 추천에 반영되지 않았어요
                    </span>
                  )}
                  <dl className="flex flex-col gap-0.5 text-caption-md">
                    {tasteRows(profile.taste).map((row) => (
                      <div key={row.label} className="flex gap-3">
                        <dt className="w-16 shrink-0 text-ink-muted">
                          {row.label}
                        </dt>
                        <dd className="text-ink">{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
                {mine && allowed.includes("EDIT_TASTE") && (
                  <Button
                    variant="outline"
                    size="sm"
                    aria-label="내 취향 수정"
                    onClick={onEditTaste}
                  >
                    수정
                  </Button>
                )}
                {!mine && allowed.includes("REMOVE_PROFILE") && (
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
                    <MenuItem
                      tone="danger"
                      onClick={() => setRemoving(profile)}
                    >
                      프로필 지우기
                    </MenuItem>
                  </Menu>
                )}
              </li>
            );
          })}
        </ul>
        <p className="mt-3 text-caption-sm text-ink-muted">
          남긴 취향은 모임 링크를 가진 사람만 볼 수 있고, 이 모임에만 써요.
        </p>
      </BottomSheet>
      <RemoveProfileDialog
        profile={removing}
        onClose={() => setRemoving(undefined)}
        onRemove={onRemoveProfile}
      />
    </>
  );
}
