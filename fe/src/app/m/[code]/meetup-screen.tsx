"use client";

import { isNotFound, useMeetupSnapshot } from "@/domains/meetup/api/queries";
import {
  MeetupInfoCard,
  meetupTitle,
} from "@/domains/meetup/ui/meetup-info-card";
import { MeetupNotFound } from "@/domains/meetup/ui/meetup-not-found";
import { Button } from "@/shared/ui/button/button";
import { Screen } from "@/shared/ui/layout/screen";
import { TopBar } from "@/shared/ui/layout/top-bar";

// 모임 링크(/m/{code}). 스냅숏으로 화면을 정한다(AC-26). 프로필과 상태별 화면은 다음 단계에서 이 위에 더한다
export function MeetupScreen({ code }: { code: string }) {
  const snapshot = useMeetupSnapshot(code);

  if (isNotFound(snapshot.error)) return <MeetupNotFound />;

  if (snapshot.isPending || snapshot.isError) {
    return (
      <Screen>
        <TopBar title="모임 장소 정하기" />
        {snapshot.isError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-4 px-8 pb-20 text-center">
            <p className="text-body-sm text-ink-muted">
              모임을 불러오지 못했어요.
            </p>
            <Button
              variant="outline"
              size="md"
              onClick={() => snapshot.refetch()}
            >
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

  const { info } = snapshot.data;
  return (
    <Screen>
      <TopBar title={meetupTitle(info)} />
      <div className="flex flex-col gap-6 px-5 pt-3 pb-6">
        <MeetupInfoCard info={info} />
      </div>
    </Screen>
  );
}
