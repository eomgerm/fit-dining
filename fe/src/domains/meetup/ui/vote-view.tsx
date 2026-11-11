"use client";

import { RadioGroup } from "@base-ui/react/radio-group";
import Link from "next/link";
import { useState } from "react";

import { cn } from "@/shared/lib/cn";
import { Button } from "@/shared/ui/button/button";
import { IconButton } from "@/shared/ui/button/icon-button";
import { TextButton } from "@/shared/ui/button/text-button";
import { Note } from "@/shared/ui/display/note";
import { Tag } from "@/shared/ui/display/tag";
import { Radio } from "@/shared/ui/form/radio";
import { CheckIcon } from "@/shared/ui/icon/icons/check";
import { ChevronLeftIcon } from "@/shared/ui/icon/icons/chevron-left";
import { BottomBar } from "@/shared/ui/layout/bottom-bar";
import { Screen } from "@/shared/ui/layout/screen";
import { TopBar } from "@/shared/ui/layout/top-bar";
import { BottomSheet } from "@/shared/ui/overlay/bottom-sheet";
import { ConfirmDialog } from "@/shared/ui/overlay/confirm-dialog";

import {
  hostProfile,
  myProfile,
  type MeetupPoll,
  type MeetupSnapshot,
} from "../model/meetup";
import {
  anonymityLine,
  closeConfirmText,
  notVotedLine,
  tiedCandidates,
  tieTitle,
  votedLine,
  voterLine,
} from "../model/poll";
import {
  distanceText,
  fitLine,
  menuText,
  PLACE_CATEGORY_LABELS,
  reasonChips,
  type MeetupResult,
  type MeetupResultItem,
} from "../model/result";
import { KeepWords } from "./keep-words";
import { meetupTitle } from "./meetup-info-card";
import type { ResultCardParts } from "./result-card";

type Candidate = MeetupPoll["candidates"][number];

function CandidateCard({
  candidate,
  item,
  snapshot,
  parts,
  href,
  mine,
  canVote,
  onPick,
}: {
  candidate: Candidate;
  item?: MeetupResultItem;
  snapshot: MeetupSnapshot;
  parts: ResultCardParts;
  href: string;
  mine: boolean;
  canVote: boolean;
  onPick: () => void;
}) {
  const meta = item
    ? [
        PLACE_CATEGORY_LABELS[item.place.categoryGroup],
        distanceText(item.distance),
        item.menu && menuText(item.menu),
      ].filter((part): part is string => !!part)
    : [];
  const fit = item && fitLine(item.fit, snapshot.profiles);
  const reason = item && reasonChips(item.reasons)[0];
  const voters = voterLine(candidate.voters, snapshot.profiles);

  return (
    <div
      className={cn(
        "flex flex-col rounded-lg ring-inset",
        mine ? "ring-2 ring-primary" : "ring-1 ring-line",
      )}
    >
      <button
        type="button"
        role="radio"
        aria-checked={mine}
        disabled={!canVote}
        onClick={onPick}
        className="flex flex-col gap-2 rounded-lg p-3.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        <span className="flex items-start gap-3">
          {canVote && (
            <span
              aria-hidden="true"
              className={cn(
                "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-1.5",
                mine
                  ? "border-primary bg-primary text-on-primary"
                  : "border-ink-subtle bg-surface",
              )}
            >
              {mine && <CheckIcon size="sm" />}
            </span>
          )}
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate text-title-md text-ink">
              {item?.place.name ?? "후보"}
            </span>
            {meta.length > 0 && (
              <span className="text-caption-md text-ink-muted">
                {meta.join(" · ")}
              </span>
            )}
          </span>
          {item?.score !== undefined && parts.score(item.score)}
        </span>
        {fit && (
          <span
            className={cn(
              "text-label-md",
              fit.misfit ? "text-ink-muted" : "text-success",
            )}
          >
            {fit.text}
          </span>
        )}
        {reason && (
          <span className="flex flex-wrap gap-1">
            <Tag variant="match">{reason}</Tag>
          </span>
        )}
        <span className="flex items-center justify-between gap-2 border-t border-line pt-2">
          <span className="min-w-0 truncate text-caption-md text-ink-muted">
            {voters}
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            {mine && (
              <span className="text-label-md text-primary">내가 고른 곳</span>
            )}
            <span className="text-title-sm text-ink">{candidate.votes}표</span>
          </span>
        </span>
      </button>
      <Link
        href={href}
        className="mx-3.5 flex h-11 items-center justify-center border-t border-line text-label-md text-ink-muted"
      >
        장소 정보 보기
      </Link>
    </div>
  );
}

// 동점이거나 마감한 투표에서 모임장이 한 곳을 고른다(투표 마감: 동점일 때)
function PickSheet({
  open,
  onOpenChange,
  poll,
  snapshot,
  items,
  pending,
  onDecide,
  onReopen,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  poll: MeetupPoll;
  snapshot: MeetupSnapshot;
  items: Map<number, MeetupResultItem>;
  pending: boolean;
  onDecide: (placeId: number) => void;
  onReopen: () => void;
}) {
  const [picked, setPicked] = useState<number>();
  const candidates = poll.tie ? tiedCandidates(poll) : poll.candidates;
  const canReopen = snapshot.allowed.includes("REOPEN_POLL");

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={poll.tie ? tieTitle(poll) : "후보 중 한 곳을 골라 주세요"}
    >
      <p className="text-body-sm text-ink-muted">
        <KeepWords>
          한 곳을 골라 주세요. 정한 곳은 친구들 화면에도 바로 보여요.
        </KeepWords>
      </p>
      <RadioGroup
        aria-label="동점 후보"
        value={picked ?? null}
        onValueChange={(value) => setPicked(value as number)}
        className="mt-3 flex flex-col"
      >
        {candidates.map((candidate) => {
          const item = items.get(candidate.placeId);
          const detail = [
            `${candidate.votes}표`,
            voterLine(candidate.voters, snapshot.profiles),
            item?.score !== undefined ? `핏 점수 ${item.score}` : "",
          ].filter((part) => !!part);
          return (
            <div
              key={candidate.placeId}
              className="flex items-center gap-2 border-b border-line last:border-b-0"
            >
              <Radio value={candidate.placeId}>
                {item?.place.name ?? "후보"}
              </Radio>
              <span className="ml-auto text-caption-md text-ink-muted">
                {detail.join(" · ")}
              </span>
            </div>
          );
        })}
      </RadioGroup>
      <div className="flex flex-col gap-2 pt-4 pb-2">
        <Button
          disabled={picked === undefined || pending}
          onClick={() => picked !== undefined && onDecide(picked)}
        >
          여기로 정하기
        </Button>
        {canReopen && (
          <Button
            variant="outline"
            size="md"
            disabled={pending}
            onClick={onReopen}
          >
            투표 계속하기
          </Button>
        )}
      </div>
    </BottomSheet>
  );
}

// 투표 화면(모임장 투표, 참여자 투표, AC-43). 열려 있는 동안 스냅숏을 5초마다 다시 받고, 투표한 수와 후보별 표 수를
// 보인다. 누르면 바로 선택을 바꾸고 실패하면 되돌린다(D-21). 모임 정보 "수정"은 결과 화면에만 있어 결과로 가는 링크를 둔다
export function VoteView({
  snapshot,
  result,
  parts,
  placeHref,
  pending,
  onBack,
  onVote,
  onClose,
  onReopen,
  onDecide,
  onShare,
  onShowResult,
  onPickName,
}: {
  snapshot: MeetupSnapshot;
  result?: MeetupResult;
  parts: ResultCardParts;
  placeHref: (placeId: number) => string;
  // 마감·계속하기·정하기 요청이 처리 중인지
  pending: boolean;
  onBack?: () => void;
  // 성공하면 true다
  onVote: (placeId: number) => Promise<boolean>;
  onClose: () => void;
  onReopen: () => void;
  onDecide: (placeId: number) => void;
  onShare: () => void;
  onShowResult: () => void;
  onPickName?: () => void;
}) {
  const poll = snapshot.poll!;
  const { me, info, allowed } = snapshot;
  const host = me.role === "HOST";
  const hostName = hostProfile(snapshot)?.name ?? info.hostNickname;
  const hostSubject = hostName ? `${hostName}님이` : "모임장이";
  const canVote = allowed.includes("VOTE");
  const canClose = allowed.includes("CLOSE_POLL");
  const canPick = allowed.includes("DECIDE");
  const [picked, setPicked] = useState<number>();
  const [confirmClose, setConfirmClose] = useState(false);
  // 마감해 고를 차례가 되면 시트를 바로 연다. 닫으면 아래 막대의 "한 곳 고르기"로 다시 연다
  const [pickDismissed, setPickDismissed] = useState(false);
  const items = new Map(
    (result?.items ?? []).map((item) => [item.place.id, item]),
  );
  const myVote = picked ?? poll.myVote;
  const votedName =
    myVote === undefined ? undefined : items.get(myVote)?.place.name;
  const votedElsewhere =
    poll.anonymous && poll.hasVoted && poll.myVote === undefined && !picked;
  const confirm = closeConfirmText(poll, snapshot.profiles);

  const pick = async (placeId: number) => {
    if (!canVote || placeId === myVote) return;
    setPicked(placeId);
    if (!(await onVote(placeId))) setPicked(undefined);
  };
  const close = () => {
    if (poll.notVotedCount > 0) setConfirmClose(true);
    else onClose();
  };

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
        title={`${meetupTitle(info)} 투표`}
      />
      <div className="flex flex-col gap-4 px-5 pt-2 pb-4">
        <section className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <Tag>{anonymityLine(poll)}</Tag>
            <TextButton onClick={onShowResult}>추천 결과 보기</TextButton>
          </div>
          {!host && (
            <p className="text-title-md text-ink">
              {hostSubject} 후보 {poll.candidates.length}곳으로 투표를 열었어요
            </p>
          )}
          <p
            className={
              host ? "text-title-md text-ink" : "text-caption-md text-ink-muted"
            }
          >
            {votedLine(poll)}
            {!host &&
              poll.anonymous &&
              " · 누가 어디를 골랐는지는 보이지 않아요"}
          </p>
          {notVotedLine(poll, snapshot.profiles) && (
            <p className="text-caption-md text-ink-muted">
              {notVotedLine(poll, snapshot.profiles)}
            </p>
          )}
          {poll.state === "OPEN" && me.profileId && (
            <p className="text-caption-md text-ink-muted">
              마감 전에는 고른 곳을 바꿀 수 있어요.
            </p>
          )}
        </section>

        {!me.profileId && <Note>투표하려면 내 이름을 골라 주세요.</Note>}
        {votedElsewhere && (
          <Note>
            {myProfile(snapshot)?.name}님은 이미 투표했어요. 익명이라 고른 곳은
            여기서 보이지 않아요. 다시 고르면 바뀌어요.
          </Note>
        )}
        {poll.state === "CLOSED" && !canPick && (
          <Note>
            {poll.tie ? `${tieTitle(poll)}. ` : "투표가 마감됐어요. "}
            {hostSubject} 고르면 정해져요.
          </Note>
        )}

        <div
          role="radiogroup"
          aria-label="후보"
          className="flex flex-col gap-3"
        >
          {poll.candidates.map((candidate) => (
            <CandidateCard
              key={candidate.placeId}
              candidate={candidate}
              item={items.get(candidate.placeId)}
              snapshot={snapshot}
              parts={parts}
              href={placeHref(candidate.placeId)}
              mine={candidate.placeId === myVote}
              canVote={canVote}
              onPick={() => pick(candidate.placeId)}
            />
          ))}
        </div>
      </div>

      {host ? (
        <BottomBar variant="divider">
          {canClose ? (
            <>
              <p className="text-center text-caption-md text-ink-muted">
                친구들은 같은 모임 링크로 투표해요
              </p>
              <div className="flex gap-2 *:flex-1">
                <Button variant="outline" size="md" onClick={onShare}>
                  모임 링크 보내기
                </Button>
                <Button size="md" disabled={pending} onClick={close}>
                  투표 마감
                </Button>
              </div>
            </>
          ) : (
            canPick && (
              <Button onClick={() => setPickDismissed(false)}>
                한 곳 고르기
              </Button>
            )
          )}
        </BottomBar>
      ) : onPickName ? (
        <BottomBar>
          <Button onClick={onPickName}>내 이름 고르기</Button>
        </BottomBar>
      ) : (
        canVote &&
        votedName && (
          <BottomBar variant="divider">
            <p className="text-title-sm text-ink">{votedName}에 투표했어요</p>
            <p className="text-caption-md text-ink-muted">
              다른 곳을 누르면 바로 바뀌어요.
              <br />
              {hostSubject} 투표를 마감하면 장소가 정해져요.
            </p>
          </BottomBar>
        )
      )}

      <ConfirmDialog
        open={confirmClose}
        onOpenChange={setConfirmClose}
        title={confirm.title}
        description={<KeepWords>{confirm.description}</KeepWords>}
        secondaryAction={
          <Button
            variant="outline"
            size="md"
            onClick={() => setConfirmClose(false)}
          >
            계속 기다리기
          </Button>
        }
        action={
          <Button
            size="md"
            disabled={pending}
            onClick={() => {
              setConfirmClose(false);
              onClose();
            }}
          >
            마감하기
          </Button>
        }
      />
      {canPick && (
        <PickSheet
          open={!pickDismissed}
          onOpenChange={(open) => setPickDismissed(!open)}
          poll={poll}
          snapshot={snapshot}
          items={items}
          pending={pending}
          onDecide={onDecide}
          onReopen={onReopen}
        />
      )}
    </Screen>
  );
}
