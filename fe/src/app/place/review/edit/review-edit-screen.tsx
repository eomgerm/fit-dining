"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { withAccessToken } from "@/domains/auth/api/with-access-token";
import { parsePlaceId, parseReviewId } from "@/domains/review/model/review";
import { ReviewEditForm } from "@/domains/review/ui/review-edit-form";
import { Button } from "@/shared/ui/button/button";
import { EmptyState } from "@/shared/ui/display/empty-state";
import { WarningIcon } from "@/shared/ui/icon/icons/warning";

import { useLeave, useSignedIn } from "../review-screen";

export function ReviewEditScreen() {
  const searchParams = useSearchParams();
  const placeId = parsePlaceId(searchParams.get("id"));
  const reviewId = parseReviewId(searchParams.get("review"));
  const { signedIn, goToLogin } = useSignedIn();
  const leave = useLeave();

  if (placeId === null || reviewId === null) {
    return (
      <main className="flex flex-1 flex-col justify-center">
        <EmptyState
          icon={<WarningIcon />}
          title="리뷰를 찾을 수 없어요"
          description="주소가 맞는지 확인해 주세요"
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

  // 수정 뒤와 나가기가 같다
  if (!signedIn) return null;
  return (
    <ReviewEditForm
      reviewId={reviewId}
      withAccessToken={withAccessToken}
      onSuccess={() => leave(placeId)}
      onClose={() => leave(placeId)}
      onSignedOut={goToLogin}
    />
  );
}
