"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";

import { parsePlaceId } from "@/domains/review/model/review";
import { SimpleReviewForm } from "@/domains/review/ui/simple-review-form";
import { Button } from "@/shared/ui/button/button";
import { EmptyState } from "@/shared/ui/display/empty-state";
import { WarningIcon } from "@/shared/ui/icon/icons/warning";

// 등록 뒤 돌아갈 장소 상세의 리뷰 탭. 장소 상세(검색 담당)가 tab=review로 리뷰 탭을 연다
function placeReviewTabHref(placeId: number) {
  return `/place?id=${placeId}&tab=review`;
}

export function ReviewWriteScreen() {
  const router = useRouter();
  const placeId = parsePlaceId(useSearchParams().get("id"));

  if (placeId === null) {
    return (
      <main className="flex flex-1 flex-col justify-center">
        <EmptyState
          tone="warn"
          icon={<WarningIcon />}
          title="장소를 찾을 수 없어요"
          description="주소를 다시 확인해 주세요."
          action={
            <Button
              render={<Link href="/" />}
              nativeButton={false}
              variant="outline"
              size="md"
            >
              처음으로
            </Button>
          }
        />
      </main>
    );
  }

  const detailHref = placeReviewTabHref(placeId);
  return (
    <SimpleReviewForm
      placeId={placeId}
      // 작성 화면이 방문 기록에 남지 않게 바꿔치기한다. 뒤로 가면 작성 전 화면으로 간다
      onSuccess={() => router.replace(detailHref)}
      // 리뷰 탭에서 들어왔으면 그 화면으로, 주소로 바로 열었으면 장소 상세로 간다
      onClose={() =>
        window.history.length > 1 ? router.back() : router.replace(detailHref)
      }
    />
  );
}
