"use client";

import { Button } from "@/shared/ui/button/button";
import { IconButton } from "@/shared/ui/button/icon-button";
import { CheckIcon } from "@/shared/ui/icon/icons/check";
import { ChevronLeftIcon } from "@/shared/ui/icon/icons/chevron-left";
import { BottomBar } from "@/shared/ui/layout/bottom-bar";
import { Screen } from "@/shared/ui/layout/screen";
import { TopBar } from "@/shared/ui/layout/top-bar";

import { hostProfile, myProfile, type MeetupSnapshot } from "../model/meetup";
import { tasteRows } from "../model/taste";

// 취향을 남긴 뒤(참여자 5). 내 취향을 보이고, 비회원에게는 로그인하면 할 수 있는 것을 알린다. 아래 버튼은 결과 전이면 대기 화면, 결과가 있으면 결과 화면을 연다(D-28)
export function DoneView({
  snapshot,
  onBack,
  onEditTaste,
  onSignIn,
  onContinue,
}: {
  snapshot: MeetupSnapshot;
  onBack?: () => void;
  onEditTaste: () => void;
  onSignIn: () => void;
  onContinue: () => void;
}) {
  const me = myProfile(snapshot);
  const hostName = hostProfile(snapshot)?.name ?? snapshot.info.hostNickname;
  const hasResult = snapshot.resultCalculationId !== undefined;
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
        title="모임 장소 정하기"
      />
      <div className="flex flex-col gap-6 px-5 pt-6 pb-4">
        <div className="flex flex-col items-center gap-3 text-center">
          <span
            aria-hidden="true"
            className="flex size-13 items-center justify-center rounded-full bg-success-soft text-success"
          >
            <CheckIcon />
          </span>
          <h2 className="text-title-lg">취향을 남겼어요</h2>
          <p className="text-body-sm text-ink-muted">
            창을 닫아도 괜찮아요. {hostName ? `${hostName}님이` : "모임장이"}{" "}
            추천받으면
            <br />
            같은 링크로 다시 들어와 주세요.
          </p>
        </div>
        <section
          aria-labelledby="my-taste"
          className="flex flex-col gap-3 rounded-lg p-4 ring-1 ring-line ring-inset"
        >
          <div className="flex items-center justify-between gap-3">
            <h3 id="my-taste" className="text-title-sm">
              내 취향{" "}
              <span className="text-caption-sm font-normal text-ink-subtle">
                링크를 가진 사람에게 보여요
              </span>
            </h3>
            {snapshot.allowed.includes("EDIT_TASTE") && (
              <Button
                variant="outline"
                size="sm"
                aria-label="내 취향 수정"
                onClick={onEditTaste}
              >
                수정
              </Button>
            )}
          </div>
          <dl className="flex flex-col gap-2 text-body-sm">
            {tasteRows(me?.taste).map((row) => (
              <div key={row.label} className="flex gap-3">
                <dt className="w-18 shrink-0 text-ink-muted">{row.label}</dt>
                <dd className="text-ink">{row.value}</dd>
              </div>
            ))}
          </dl>
        </section>
        {!snapshot.me.signedIn && (
          <div className="flex items-center gap-3 rounded-md bg-surface-warm py-2.5 pr-2.5 pl-3.5">
            <p className="flex-1 text-caption-md text-ink-muted">
              로그인하면 평소 취향도 함께 반영하고, 다녀온 뒤 평가할 수 있어요
            </p>
            <Button variant="outline" size="sm" onClick={onSignIn}>
              로그인
            </Button>
          </div>
        )}
      </div>
      <BottomBar>
        {!hasResult && (
          <p className="text-center text-caption-sm text-ink-subtle">
            추천이 나오면 &apos;추천 결과 보기&apos;로 바뀌어요
          </p>
        )}
        <Button variant="outline" size="md" onClick={onContinue}>
          {hasResult ? "추천 결과 보기" : "친구들 취향 보기"}
        </Button>
      </BottomBar>
    </Screen>
  );
}
