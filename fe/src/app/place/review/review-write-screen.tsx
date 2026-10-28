"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { withAccessToken } from "@/domains/auth/api/with-access-token";
import { parsePlaceId } from "@/domains/review/model/review";
import { ReviewForm } from "@/domains/review/ui/review-form";
import { Button } from "@/shared/ui/button/button";
import { EmptyState } from "@/shared/ui/display/empty-state";
import { PinOffIcon } from "@/shared/ui/icon/icons/pin-off";

import { useLeave, useSignedIn } from "./review-screen";

export function ReviewWriteScreen() {
  const placeId = parsePlaceId(useSearchParams().get("id"));
  const { signedIn, goToLogin } = useSignedIn();
  const leave = useLeave();

  if (placeId === null) {
    return (
      <main className="flex flex-1 flex-col justify-center">
        <EmptyState
          icon={<PinOffIcon />}
          title="장소를 찾을 수 없어요"
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

  // 등록 뒤와 닫기가 같다
  if (!signedIn) return null;
  return (
    <ReviewForm
      placeId={placeId}
      withAccessToken={withAccessToken}
      onSuccess={() => leave(placeId)}
      onClose={() => leave(placeId)}
      onSignedOut={goToLogin}
    />
  );
}
