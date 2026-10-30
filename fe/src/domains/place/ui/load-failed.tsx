import { isApiError } from "@/shared/api/api-error";
import { Button } from "@/shared/ui/button/button";
import { EmptyState } from "@/shared/ui/display/empty-state";
import { RefreshIcon } from "@/shared/ui/icon/icons/refresh";
import { WarningIcon } from "@/shared/ui/icon/icons/warning";
import { WifiOffIcon } from "@/shared/ui/icon/icons/wifi-off";

type LoadFailedProps = {
  error: unknown;
  // 서버 오류일 때의 제목(예: "추천을 불러오지 못했어요"). 연결 문제면 연결 안내로 바꾼다
  title: string;
  onRetry: () => void;
  className?: string;
};

// 연결 실패. 서버 오류와 문구가 다르다
export function isOfflineError(error: unknown) {
  return isApiError(error) && error.kind === "network";
}

// 불러오기 실패(4-E02, 4-E03, 5-E03, 5-E04, 6-02). 서버 오류는 경고 색, 연결 실패는 회색 아이콘에 연결 안내 문구다
export function LoadFailed({
  error,
  title,
  onRetry,
  className,
}: LoadFailedProps) {
  const offline = isOfflineError(error);
  return (
    <EmptyState
      role="alert"
      tone={offline ? "default" : "warn"}
      icon={offline ? <WifiOffIcon /> : <WarningIcon />}
      title={offline ? "인터넷에 연결되어 있지 않아요" : title}
      description={
        offline
          ? "연결을 확인하고 다시 시도해 주세요."
          : "잠시 후 다시 시도해 주세요."
      }
      action={
        <Button variant="outline" size="md" onClick={onRetry}>
          <RefreshIcon size="md" className="mr-2" />
          다시 시도
        </Button>
      }
      className={className}
    />
  );
}
