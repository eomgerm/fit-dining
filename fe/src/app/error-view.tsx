import Link from "next/link";

import { Button } from "@/shared/ui/button/button";
import { EmptyState } from "@/shared/ui/display/empty-state";
import { RefreshIcon } from "@/shared/ui/icon/icons/refresh";
import { WarningIcon } from "@/shared/ui/icon/icons/warning";

// error.tsx와 global-error.tsx의 화면. 불러오기 실패(LoadFailed)와 같은 꼴이다.
// 오류 내용은 보이지 않는다. 운영에서는 서버 오류의 메시지가 가려져 digest만 온다
export function ErrorView({ retry }: { retry: () => void }) {
  return (
    <main className="flex flex-1 flex-col justify-center">
      <EmptyState
        role="alert"
        tone="warn"
        icon={<WarningIcon />}
        title="문제가 생겼어요"
        description="잠시 후 다시 시도해 주세요."
        action={
          <div className="flex gap-2">
            <Button variant="outline" size="md" onClick={retry}>
              <RefreshIcon size="md" className="mr-2" />
              다시 시도
            </Button>
            <Button
              render={<Link href="/" />}
              nativeButton={false}
              variant="outline"
              size="md"
            >
              처음으로
            </Button>
          </div>
        }
      />
    </main>
  );
}
