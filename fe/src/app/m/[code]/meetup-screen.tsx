"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { authenticated } from "@/domains/auth/api/authenticated";
import {
  conflictOf,
  isNotFound,
  useCancelDecision,
  useClosePoll,
  useDecide,
  useMeetupResult,
  useMeetupSnapshot,
  useOpenPoll,
  useRemoveProfile,
  useReopenPoll,
  useSelectProfile,
  useStartCalculation,
  useVote,
  type WithSession,
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
import { LinkAccountDialog } from "@/domains/meetup/ui/link-account-dialog";
import { meetupTitle } from "@/domains/meetup/ui/meetup-info-card";
import { MeetupNotFound } from "@/domains/meetup/ui/meetup-not-found";
import {
  ConfirmProfileDialog,
  JoinAgainDialog,
  MemberProfileDialog,
} from "@/domains/meetup/ui/picker-dialogs";
import { TasteAfterDecisionDialog } from "@/domains/meetup/ui/poll-parts";
import { ProfilePicker } from "@/domains/meetup/ui/profile-picker";
import type { ResultCardParts } from "@/domains/meetup/ui/result-card";
import {
  ResultView,
  type ResultViewState,
} from "@/domains/meetup/ui/result-view";
import { VoteView } from "@/domains/meetup/ui/vote-view";
import { WaitingView } from "@/domains/meetup/ui/waiting-view";
import { FitScore } from "@/domains/place/ui/fit-score";
import { reviewWriteHref } from "@/domains/review/model/review";
import { PlacePhoto, RankBadge } from "@/domains/place/ui/place-parts";
import { isApiError } from "@/shared/api/api-error";
import { copyLink, shareLink } from "@/shared/lib/share";
import { Button } from "@/shared/ui/button/button";
import { Screen } from "@/shared/ui/layout/screen";
import { TopBar } from "@/shared/ui/layout/top-bar";
import { useToast } from "@/shared/ui/overlay/toast";

import { rememberLoginReturn } from "../../login-return";

const withSession: WithSession = (send) => authenticated(() => send());

// 결과 카드의 장소 사진, 순위 배지, 핏 점수는 장소 도메인의 부품이다(D-20)
const RESULT_PARTS: ResultCardParts = {
  photo: (src) => (
    <PlacePhoto src={src} className="size-19 shrink-0 rounded-md" />
  ),
  rank: (rank) => <RankBadge rank={rank} />,
  score: (score) => <FitScore score={score} />,
};

// 투표와 정하기의 409를 짧게 알린다(AC-35). 스냅숏은 쓰기가 끝나면 다시 받는다
function pollFailure(error: unknown, fallback: string) {
  switch (conflictOf(error)) {
    case "poll-closed":
      return "투표가 마감돼서 고른 곳을 바꾸지 못했어요";
    case "no-votes":
      return "아직 아무도 투표하지 않아 마감할 수 없어요";
    case "calculating":
      return "지금 추천을 찾고 있어요. 끝난 뒤 다시 해 주세요";
    case "phase":
      return "모임 상태가 바뀌었어요. 바뀐 화면을 확인해 주세요";
    default:
      return fallback;
  }
}

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
// 질문지, 프로필이 있으면 대기 화면이나 결과 화면이다. 계산 중이면 누구에게나 찾는 중을 보인다(AC-31).
// view="profiles"(/m/{code}/profiles)는 프로필 고르기를 바로 연다
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
  return (
    <>
      <MeetupBody code={code} snapshot={data} />
      <LinkAccountDialog
        code={code}
        snapshot={data}
        withSession={withSession}
      />
    </>
  );
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
  const calculation = useStartCalculation(code);
  const result = useMeetupResult(code, snapshot.resultCalculationId);
  const openPoll = useOpenPoll(code);
  const vote = useVote(code);
  const closePoll = useClosePoll(code);
  const reopenPoll = useReopenPoll(code);
  const decide = useDecide(code);
  const cancelDecision = useCancelDecision(code);
  const pollPending =
    openPoll.isPending ||
    closePoll.isPending ||
    reopenPoll.isPending ||
    decide.isPending ||
    cancelDecision.isPending;
  // 투표 중에 결과 화면을 보는지. 모임 정보 "수정"은 결과 화면에만 있다(AC-30)
  const [showResult, setShowResult] = useState(false);
  const [tasteNotice, setTasteNotice] = useState(false);
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
  const goEditTaste = () => {
    clearJustJoined(code);
    router.push(`${meetupHref(code)}/taste`);
  };
  // 정한 곳이 있으면 추천이 바뀌지 않는다는 것을 먼저 알린다(AC-45)
  const editTaste = () => {
    if (snapshot.decision) setTasteNotice(true);
    else goEditTaste();
  };
  const succeeded = <T,>(send: Promise<T>, fallback: string) =>
    send.then(
      () => true,
      (error: unknown) => {
        toast(pollFailure(error, fallback));
        return false;
      },
    );
  const join = () => router.push(`${meetupHref(code)}/join`);
  const editInfo = () => router.push(`${meetupHref(code)}/edit`);
  const calculate = () =>
    calculation.mutate(undefined, {
      onError: (error) =>
        toast(
          conflictOf(error) === "calculating"
            ? "이미 추천을 찾고 있어요"
            : "추천받지 못했어요. 잠시 뒤 다시 시도해 주세요",
        ),
    });
  const removeProfile = (profile: MeetupProfile) =>
    remove.mutate(profile.id, {
      onSuccess: () => toast(`'${profile.name}' 프로필을 지웠어요`),
      onError: (error) =>
        toast(
          conflictOf(error) === "host-profile"
            ? "모임장 프로필은 지울 수 없어요"
            : "프로필을 지우지 못했어요. 잠시 뒤 다시 시도해 주세요",
        ),
    });
  const host = snapshot.me.role === "HOST";
  const resultState = viewState(snapshot, host, result.data, result.isError);
  const resultView = (onPickName?: () => void) =>
    resultState && (
      <ResultView
        snapshot={snapshot}
        result={result.data}
        state={resultState}
        parts={RESULT_PARTS}
        placeHref={(placeId) => `/places/${placeId}?meetup=${code}`}
        calculating={calculation.isPending}
        onBack={host ? () => router.push("/m") : undefined}
        onCalculate={calculate}
        onReload={() => result.refetch()}
        onEditTaste={editTaste}
        onRemoveProfile={removeProfile}
        onPickName={onPickName}
        onEditInfo={editInfo}
        pollPending={pollPending}
        onOpenPoll={(placeIds, anonymous) =>
          succeeded(
            openPoll.mutateAsync({ placeIds, anonymous }),
            "투표를 열지 못했어요. 잠시 뒤 다시 시도해 주세요",
          )
        }
        onDecide={(placeId) =>
          succeeded(
            decide.mutateAsync(placeId),
            "정하지 못했어요. 잠시 뒤 다시 시도해 주세요",
          )
        }
        onCancelDecision={() =>
          succeeded(
            cancelDecision.mutateAsync(),
            "정하기를 취소하지 못했어요. 잠시 뒤 다시 시도해 주세요",
          )
        }
        onShowVote={() => setShowResult(false)}
        onReview={(placeId) =>
          router.push(reviewWriteHref(placeId, snapshot.info.date))
        }
        onSignIn={() => signIn(meetupHref(code))}
      />
    );
  // 투표 중에는 투표 화면이 먼저다. 결과 화면은 "추천 결과 보기"로 연다
  const voteView = (onPickName?: () => void) =>
    snapshot.phase === "VOTING" &&
    snapshot.poll &&
    !showResult && (
      <VoteView
        snapshot={snapshot}
        result={result.data}
        parts={RESULT_PARTS}
        placeHref={(placeId) => `/places/${placeId}?meetup=${code}`}
        pending={pollPending}
        onBack={host ? () => router.push("/m") : undefined}
        onVote={(placeId) =>
          succeeded(
            vote.mutateAsync(placeId),
            "투표하지 못했어요. 잠시 뒤 다시 시도해 주세요",
          )
        }
        onClose={() =>
          succeeded(
            closePoll.mutateAsync(),
            "마감하지 못했어요. 잠시 뒤 다시 시도해 주세요",
          )
        }
        onReopen={() =>
          succeeded(
            reopenPoll.mutateAsync(),
            "투표를 다시 열지 못했어요. 잠시 뒤 다시 시도해 주세요",
          )
        }
        onDecide={(placeId) =>
          succeeded(
            decide.mutateAsync(placeId),
            "정하지 못했어요. 잠시 뒤 다시 시도해 주세요",
          )
        }
        onShare={share}
        onShowResult={() => setShowResult(true)}
        onPickName={onPickName}
      />
    );
  const tasteDialog = (
    <TasteAfterDecisionDialog
      open={tasteNotice}
      onClose={() => setTasteNotice(false)}
      onEdit={goEditTaste}
    />
  );

  if (snapshot.me.profileId) {
    if (snapshot.me.role !== "HOST" && justJoined) {
      return (
        <DoneView
          snapshot={snapshot}
          onEditTaste={editTaste}
          onSignIn={() => signIn(meetupHref(code))}
          onContinue={() => {
            clearJustJoined(code);
            setJustJoined(false);
          }}
        />
      );
    }
    return (
      <>
        {voteView() || resultView() || (
          <WaitingView
            snapshot={snapshot}
            onBack={host ? () => router.push("/m") : undefined}
            onShare={share}
            onCopy={copy}
            onEditTaste={editTaste}
            onRemoveProfile={removeProfile}
            onCalculate={calculate}
            calculating={calculation.isPending}
            onEditInfo={editInfo}
          />
        )}
        {tasteDialog}
      </>
    );
  }

  if (viewOnly) {
    const pickName = () => setViewOnly(false);
    return (
      voteView(pickName) ||
      resultView(pickName) || (
        <WaitingView
          snapshot={snapshot}
          onShare={share}
          onCopy={copy}
          onEditTaste={editTaste}
          onRemoveProfile={() => {}}
          onPickName={pickName}
        />
      )
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

// 결과 화면을 열지와 그 상태. 결과도 계산도 없으면 undefined(대기 화면)다. 실패한 계산의 다시 시도는 모임장만 할 수
// 있어, 결과가 없으면 참여자에게는 대기 화면을 그대로 보인다
function viewState(
  snapshot: MeetupSnapshot,
  host: boolean,
  result: unknown,
  resultFailed: boolean,
): ResultViewState | undefined {
  const state = snapshot.calculation?.state;
  if (state === "RUNNING") return "finding";
  if (snapshot.resultCalculationId === undefined)
    return state === "FAILED" && host ? "failed" : undefined;
  return result || resultFailed ? "ready" : "loading";
}
