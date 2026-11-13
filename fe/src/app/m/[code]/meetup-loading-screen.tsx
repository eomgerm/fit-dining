"use client";

import { LoadFailed } from "@/domains/place/ui/load-failed";
import { ApiError } from "@/shared/api/api-error";
import { IconButton } from "@/shared/ui/button/icon-button";
import { ChevronLeftIcon } from "@/shared/ui/icon/icons/chevron-left";
import { Screen } from "@/shared/ui/layout/screen";
import { TopBar } from "@/shared/ui/layout/top-bar";

// 연결이 없으면 스냅숏 요청이 실패하지 않고 멈춘다. 이때도 연결 끊김으로 알린다
const OFFLINE = new ApiError("network", "offline");

type SnapshotState = {
  isError: boolean;
  isPaused: boolean;
  error: unknown;
  refetch: () => unknown;
};

// 스냅숏을 받는 동안과 받지 못했을 때의 화면. 실패하면 서버 오류와 연결 끊김을 나눠 알리고 다시 시도를 둔다
export function MeetupLoadingScreen({
  title,
  snapshot,
  onBack,
}: {
  title: string;
  snapshot: SnapshotState;
  onBack?: () => void;
}) {
  const failed = snapshot.isError || snapshot.isPaused;
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
        title={title}
      />
      {failed ? (
        <div className="flex flex-1 flex-col justify-center pb-20">
          <LoadFailed
            error={snapshot.isPaused ? OFFLINE : snapshot.error}
            title="모임을 불러오지 못했어요"
            onRetry={() => snapshot.refetch()}
          />
        </div>
      ) : (
        <div className="px-5 pt-3" aria-busy="true">
          <div className="h-32 animate-pulse rounded-lg bg-surface-sunken motion-reduce:animate-none" />
        </div>
      )}
    </Screen>
  );
}
