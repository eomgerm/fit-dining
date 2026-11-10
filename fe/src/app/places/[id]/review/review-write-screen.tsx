"use client";

import { authenticated } from "@/domains/auth/api/authenticated";
import { ReviewForm } from "@/domains/review/ui/review-form";

import { useLeave, useSignedIn } from "../review-screen";

export function ReviewWriteScreen({ placeId }: { placeId: number }) {
  const { signedIn, goToLogin } = useSignedIn();
  const leave = useLeave();

  // 등록 뒤와 닫기가 같다
  if (!signedIn) return null;
  return (
    <ReviewForm
      placeId={placeId}
      authenticated={authenticated}
      onSuccess={() => leave(placeId)}
      onClose={() => leave(placeId)}
      onSignedOut={goToLogin}
    />
  );
}
