"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import {
  conflictOf,
  isNotFound,
  useMeetupSnapshot,
  useRemoveProfile,
  useSelectProfile,
} from "@/domains/meetup/api/queries";
import {
  clearJustJoined,
  isJustJoined,
} from "@/domains/meetup/model/just-joined";
import {
  meetupHref,
  type MeetupProfile,
  type MeetupSnapshot,
} from "@/domains/meetup/model/meetup";
import { DoneView } from "@/domains/meetup/ui/done-view";
import { meetupTitle } from "@/domains/meetup/ui/meetup-info-card";
import { MeetupNotFound } from "@/domains/meetup/ui/meetup-not-found";
import {
  ConfirmProfileDialog,
  JoinAgainDialog,
  MemberProfileDialog,
} from "@/domains/meetup/ui/picker-dialogs";
import { ProfilePicker } from "@/domains/meetup/ui/profile-picker";
import { WaitingView } from "@/domains/meetup/ui/waiting-view";
import { isApiError } from "@/shared/api/api-error";
import { copyLink, shareLink } from "@/shared/lib/share";
import { Button } from "@/shared/ui/button/button";
import { Screen } from "@/shared/ui/layout/screen";
import { TopBar } from "@/shared/ui/layout/top-bar";
import { useToast } from "@/shared/ui/overlay/toast";

import { rememberLoginReturn } from "../../login-return";

function LoadingScreen({
  failed,
  onRetry,
}: {
  failed: boolean;
  onRetry: () => void;
}) {
  return (
    <Screen>
      <TopBar title="모임 장소 정하기" />
      {failed ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 pb-20 text-center">
          <p className="text-body-sm text-ink-muted">
            모임을 불러오지 못했어요.
          </p>
          <Button variant="outline" size="md" onClick={onRetry}>
            다시 시도
          </Button>
        </div>
      ) : (
        <div className="px-5 pt-3" aria-busy="true">
          <div className="h-32 animate-pulse rounded-lg bg-surface-sunken motion-reduce:animate-none" />
        </div>
      )}
    </Screen>
  );
}

// 모임 링크(/m/{code}). 스냅숏으로 화면을 정한다(AC-26). 프로필이 없으면 프로필 고르기, 모임장에게 프로필이 없으면
// 질문지, 프로필이 있으면 대기 화면이다. view="profiles"(/m/{code}/profiles)는 프로필 고르기를 바로 연다
export function MeetupScreen({
  code,
  view,
}: {
  code: string;
  view?: "profiles";
}) {
  const router = useRouter();
  const snapshot = useMeetupSnapshot(code);
  const data = snapshot.data;
  const hostWithoutProfile = data?.me.role === "HOST" && !data.me.profileId;
  const joinedProfiles = view === "profiles" && !!data?.me.profileId;

  useEffect(() => {
    if (hostWithoutProfile) router.replace(`${meetupHref(code)}/join`);
    else if (joinedProfiles) router.replace(meetupHref(code));
  }, [hostWithoutProfile, joinedProfiles, code, router]);

  if (isNotFound(snapshot.error)) return <MeetupNotFound />;
  if (!data || hostWithoutProfile || joinedProfiles) {
    return (
      <LoadingScreen
        failed={snapshot.isError}
        onRetry={() => snapshot.refetch()}
      />
    );
  }
  return <MeetupBody code={code} snapshot={data} />;
}

function MeetupBody({
  code,
  snapshot,
}: {
  code: string;
  snapshot: MeetupSnapshot;
}) {
  const router = useRouter();
  const toast = useToast();
  const select = useSelectProfile(code);
  const remove = useRemoveProfile(code);
  const [viewOnly, setViewOnly] = useState(false);
  const [confirming, setConfirming] = useState<MeetupProfile>();
  const [memberPicked, setMemberPicked] = useState<MeetupProfile>();
  const [askJoin, setAskJoin] = useState(false);
  const [justJoined, setJustJoined] = useState(() => isJustJoined(code));

  const link = () => `${window.location.origin}${meetupHref(code)}`;
  const share = async () => {
    const result = await shareLink(link(), meetupTitle(snapshot.info));
    if (result === "copied") toast("링크를 복사했어요");
    if (result === "failed") toast("링크를 복사하지 못했어요");
  };
  const copy = async () =>
    toast(
      (await copyLink(link()))
        ? "링크를 복사했어요"
        : "링크를 복사하지 못했어요",
    );
  const signIn = (path: string) => {
    rememberLoginReturn(path);
    router.push("/login");
  };
  const editTaste = () => {
    clearJustJoined(code);
    router.push(`${meetupHref(code)}/taste`);
  };
  const join = () => router.push(`${meetupHref(code)}/join`);

  if (snapshot.me.profileId) {
    if (snapshot.me.role !== "HOST" && justJoined) {
      return (
        <DoneView
          snapshot={snapshot}
          onEditTaste={editTaste}
          onSignIn={() => signIn(meetupHref(code))}
          onShowFriends={() => {
            clearJustJoined(code);
            setJustJoined(false);
          }}
        />
      );
    }
    return (
      <WaitingView
        snapshot={snapshot}
        onBack={
          snapshot.me.role === "HOST" ? () => router.push("/") : undefined
        }
        onShare={share}
        onCopy={copy}
        onEditTaste={editTaste}
        onRemoveProfile={(profile) =>
          remove.mutate(profile.id, {
            onSuccess: () => toast(`'${profile.name}' 프로필을 지웠어요`),
            onError: (error) =>
              toast(
                conflictOf(error) === "host-profile"
                  ? "모임장 프로필은 지울 수 없어요"
                  : "프로필을 지우지 못했어요. 잠시 뒤 다시 시도해 주세요",
              ),
          })
        }
      />
    );
  }

  if (viewOnly) {
    return (
      <WaitingView
        snapshot={snapshot}
        onShare={share}
        onCopy={copy}
        onEditTaste={editTaste}
        onRemoveProfile={() => {}}
        onPickName={() => setViewOnly(false)}
      />
    );
  }

  const headcount = snapshot.info.headcount;
  return (
    <>
      <ProfilePicker
        snapshot={snapshot}
        onPick={(profile) => {
          if (!profile.member) setConfirming(profile);
          else if (!snapshot.me.signedIn) setMemberPicked(profile);
          else toast("다른 회원으로 로그인돼 있어 이 이름을 고를 수 없어요");
        }}
        onJoin={() => {
          if (headcount !== undefined && snapshot.profiles.length >= headcount)
            setAskJoin(true);
          else join();
        }}
        onViewOnly={() => setViewOnly(true)}
      />
      <ConfirmProfileDialog
        profile={confirming}
        pending={select.isPending}
        onCancel={() => setConfirming(undefined)}
        onConfirm={(profile) =>
          select.mutate(profile.id, {
            onSettled: () => setConfirming(undefined),
            onError: (error) =>
              toast(
                isApiError(error) && error.status === 404
                  ? "지워진 이름이에요. 목록을 다시 확인해 주세요"
                  : "들어가지 못했어요. 잠시 뒤 다시 시도해 주세요",
              ),
          })
        }
      />
      <MemberProfileDialog
        profile={memberPicked}
        onCancel={() => setMemberPicked(undefined)}
        onSignIn={() => signIn(meetupHref(code))}
      />
      <JoinAgainDialog
        open={askJoin}
        count={snapshot.profiles.length}
        onPickName={() => setAskJoin(false)}
        onJoin={() => {
          setAskJoin(false);
          join();
        }}
      />
    </>
  );
}
