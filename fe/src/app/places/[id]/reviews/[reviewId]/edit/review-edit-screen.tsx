"use client";

import { authenticated } from "@/domains/auth/api/authenticated";
import { ReviewEditForm } from "@/domains/review/ui/review-edit-form";

import { useLeave, useSignedIn } from "../../../review-screen";

export function ReviewEditScreen({
  placeId,
  reviewId,
}: {
  placeId: number;
  reviewId: number;
}) {
  const { signedIn, goToLogin } = useSignedIn();
  const leave = useLeave();

  // 수정 뒤와 나가기가 같다
  if (!signedIn) return null;
  return (
    <ReviewEditForm
      reviewId={reviewId}
      authenticated={authenticated}
      onSuccess={() => leave(placeId)}
      onClose={() => leave(placeId)}
      onSignedOut={goToLogin}
    />
  );
}
