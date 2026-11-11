"use client";

import { useState, type ReactNode } from "react";

import { Button } from "@/shared/ui/button/button";
import { IconButton } from "@/shared/ui/button/icon-button";
import { EmptyState } from "@/shared/ui/display/empty-state";
import { Note } from "@/shared/ui/display/note";
import { Tag } from "@/shared/ui/display/tag";
import { ChevronLeftIcon } from "@/shared/ui/icon/icons/chevron-left";
import { InfoIcon } from "@/shared/ui/icon/icons/info";
import { RefreshIcon } from "@/shared/ui/icon/icons/refresh";
import { SearchIcon } from "@/shared/ui/icon/icons/search";
import { WarningIcon } from "@/shared/ui/icon/icons/warning";
import { BottomBar } from "@/shared/ui/layout/bottom-bar";
import { Screen } from "@/shared/ui/layout/screen";
import { TopBar } from "@/shared/ui/layout/top-bar";

import {
  hostProfile,
  type MeetupProfile,
  type MeetupSnapshot,
} from "../model/meetup";
import { formatClock } from "../model/meetup-date";
import {
  conditionChips,
  type MeetupResult,
  type MeetupResultItem,
} from "../model/result";
import { FriendsSheet } from "./friends-sheet";
import { meetupTitle } from "./meetup-info-card";
import { ResultCard, type ResultCardParts } from "./result-card";

// 결과 화면의 상태. 찾는 중과 불러오기 실패는 상태 모음 3이다
export type ResultViewState = "ready" | "finding" | "failed" | "loading";

function FindingCards() {
  return (
    <>
      {[0, 1].map((key) => (
        <div
          key={key}
          aria-hidden="true"
          className="flex gap-3 rounded-lg p-3.5 ring-1 ring-line ring-inset"
        >
          <span className="size-19 shrink-0 skeleton rounded-md" />
          <span className="flex flex-1 flex-col gap-2.5 pt-1">
            <span className="h-4.5 w-3/5 skeleton rounded-sm" />
            <span className="h-3 w-2/5 skeleton rounded-sm" />
            <span className="h-5.5 w-2/3 skeleton rounded-sm" />
          </span>
        </div>
      ))}
    </>
  );
}

function ResultGroup({
  title,
  items,
  render,
}: {
  title: string;
  items: MeetupResultItem[];
  render: (item: MeetupResultItem) => ReactNode;
}) {
  if (!items.length) return null;
  return (
    <section className="flex flex-col gap-3">
      <h2 className="mt-1 text-label-md text-ink-muted">{title}</h2>
      {items.map(render)}
    </section>
  );
}

// 결과 위 다시 추천받기 안내의 글. 반영되지 않은 사람이 있으면 그 이름을 말한다
function outdatedText(profiles: MeetupProfile[]) {
  const late = profiles.filter((profile) => !profile.reflected);
  if (!late.length) return "추천받은 뒤에 모임이 바뀌었어요";
  return `${late.map((profile) => `${profile.name}님`).join(", ")}이 방금 취향을 남겼어요`;
}

// 추천 결과(모임장 6, 참여자 7, AC-19 ~ AC-21, AC-30 ~ AC-32). 모임장에게만 다시 추천받기와 첫 줄 오른쪽의 모임 정보
// "수정"이 있다. 투표·정하기는 그 기능의 단계에서 붙인다
export function ResultView({
  snapshot,
  result,
  state,
  parts,
  placeHref,
  calculating,
  onBack,
  onCalculate,
  onReload,
  onEditTaste,
  onRemoveProfile,
  onPickName,
  onEditInfo,
}: {
  snapshot: MeetupSnapshot;
  result?: MeetupResult;
  state: ResultViewState;
  parts: ResultCardParts;
  placeHref: (placeId: number) => string;
  // 추천받기 요청이 처리 중인지
  calculating: boolean;
  onBack?: () => void;
  onCalculate: () => void;
  // 결과를 받지 못했을 때 다시 받는다
  onReload: () => void;
  onEditTaste: () => void;
  onRemoveProfile: (profile: MeetupProfile) => void;
  // 프로필 없이 보는 사람이 이름을 고르러 간다
  onPickName?: () => void;
  onEditInfo?: () => void;
}) {
  const [friendsOpen, setFriendsOpen] = useState(false);
  const { me, info, profiles, allowed, calculation } = snapshot;
  const host = me.role === "HOST";
  const hostName = hostProfile(snapshot)?.name ?? info.hostNickname;
  const hostSubject = hostName ? `${hostName}님이` : "모임장이";
  const canCalculate = allowed.includes("CALCULATE");
  const canEditInfo =
    allowed.includes("EDIT_INFO") || allowed.includes("EDIT_DATE");

  const body = () => {
    if (state === "finding") {
      return (
        <div aria-busy="true" className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <p className="text-title-md text-ink">
              {calculation?.tasteCount ?? profiles.length}명의 취향에 맞는 곳을
              찾고 있어요
            </p>
            <p className="text-caption-md text-ink-muted">
              보통 몇 초면 끝나요
            </p>
          </div>
          <FindingCards />
        </div>
      );
    }
    if (state === "failed") {
      return (
        <EmptyState
          tone="warn"
          icon={<WarningIcon />}
          title="추천을 불러오지 못했어요"
          description={
            <>
              잠시 후 다시 시도해 주세요.
              <br />
              남긴 취향은 그대로 있어요.
            </>
          }
          action={
            canCalculate && (
              <Button
                variant="outline"
                size="md"
                disabled={calculating}
                onClick={onCalculate}
              >
                <RefreshIcon size="md" className="mr-1.5" />
                다시 시도
              </Button>
            )
          }
          className="mt-12"
        />
      );
    }
    if (!result) {
      return state === "loading" ? (
        <div aria-busy="true" className="flex flex-col gap-4">
          <FindingCards />
        </div>
      ) : (
        <EmptyState
          tone="warn"
          icon={<WarningIcon />}
          title="결과를 불러오지 못했어요"
          action={
            <Button variant="outline" size="md" onClick={onReload}>
              다시 시도
            </Button>
          }
          className="mt-12"
        />
      );
    }

    const chips = conditionChips(info, result.applied);
    const card = (item: MeetupResultItem) => (
      <ResultCard
        key={item.place.id}
        item={item}
        info={info}
        profiles={profiles}
        href={placeHref(item.place.id)}
        parts={parts}
      />
    );
    return (
      <>
        <section className="flex flex-col gap-2">
          <div className="flex items-center gap-3">
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <p className="text-title-md text-ink">
                {result.tasteCount}명의 취향으로 추천했어요
              </p>
              <div className="flex flex-wrap gap-1">
                {chips.map((chip) => (
                  <Tag key={chip}>{chip}</Tag>
                ))}
              </div>
            </div>
            {canEditInfo && onEditInfo && (
              <Button
                variant="outline"
                size="sm"
                aria-label="모임 정보 수정"
                onClick={onEditInfo}
              >
                수정
              </Button>
            )}
          </div>
          <div className="flex items-center justify-between">
            <p className="text-caption-sm text-ink-subtle">
              {formatClock(result.calculatedAt)} 추천
            </p>
            <button
              type="button"
              className="h-8 px-0.5 text-label-md text-ink underline underline-offset-2"
              onClick={() => setFriendsOpen(true)}
            >
              친구들 취향 보기
            </button>
          </div>
          {result.items.some((item) => item.score !== undefined) && (
            <p className="flex items-center gap-1 text-caption-sm text-ink-subtle">
              <InfoIcon size="sm" className="shrink-0" />핏 점수는 모임 설명과
              취향에 맞는 정도예요 (100점 만점)
            </p>
          )}
        </section>

        {canCalculate && calculation?.outdated && (
          <div className="flex items-center gap-2 rounded-md bg-primary-soft py-1.5 pr-1.5 pl-3.5">
            <span className="flex-1 text-label-md text-primary">
              {outdatedText(profiles)}
            </span>
            <Button size="sm" disabled={calculating} onClick={onCalculate}>
              다시 추천받기
            </Button>
          </div>
        )}
        {host && calculation?.state === "FAILED" && (
          <Note tone="warn">
            다시 추천받지 못했어요. 잠시 후 다시 시도해 주세요.
          </Note>
        )}
        {!host && me.tasteReflected === false && (
          <Note tone="warn">
            내 취향은 아직 추천에 반영되지 않았어요. {hostSubject} 다시
            추천받으면 반영돼요.
          </Note>
        )}
        {!host && snapshot.phase === "RESULT" && (
          <p className="flex items-start gap-2 rounded-md bg-info-soft px-3.5 py-3 text-caption-md text-info">
            <InfoIcon size="sm" className="mt-px shrink-0" />
            <span>{hostSubject} 투표를 열면 여기서 투표할 수 있어요.</span>
          </p>
        )}

        {result.items.length ? (
          <>
            <ResultGroup
              title="모두에게 잘 맞는 곳"
              items={result.items.filter((item) => item.group === "ALL_FIT")}
              render={card}
            />
            <ResultGroup
              title="취향이 조금 갈리는 곳"
              items={result.items.filter(
                (item) => item.group === "SOME_MISFIT",
              )}
              render={card}
            />
          </>
        ) : (
          <EmptyState
            icon={<SearchIcon />}
            title="조건에 맞는 곳이 없어요"
            description={result.emptyReason?.cause}
            className="mt-4"
          />
        )}
        {result.emptyReason?.suggestion && !result.items.length && (
          <Note>{result.emptyReason.suggestion}</Note>
        )}
      </>
    );
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
        title={`${meetupTitle(info)} 결과`}
      />
      <div className="flex flex-col gap-4 px-5 pt-2 pb-4">{body()}</div>
      {onPickName && (
        <BottomBar>
          <Button onClick={onPickName}>내 이름 고르기</Button>
        </BottomBar>
      )}
      <FriendsSheet
        open={friendsOpen}
        onOpenChange={setFriendsOpen}
        snapshot={snapshot}
        onEditTaste={onEditTaste}
        onRemoveProfile={onRemoveProfile}
      />
    </Screen>
  );
}
