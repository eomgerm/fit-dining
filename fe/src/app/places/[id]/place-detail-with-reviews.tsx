"use client";

import { useRouter } from "next/navigation";

import { authenticated } from "@/domains/auth/api/authenticated";
import type { PlaceFit } from "@/domains/place/model/place-types";
import { PlaceDetailScreen } from "@/domains/place/ui/place-detail-screen";
import { reviewEditHref, reviewWriteHref } from "@/domains/review/model/review";
import { ReviewEntryButton } from "@/domains/review/ui/review-entry-button";
import { ReviewSection } from "@/domains/review/ui/review-section";

import { rememberLoginReturn } from "../../login-return";
import { useBookmarkAccess } from "../../use-bookmark-access";
import { withOptionalSession } from "./with-optional-session";

// 장소 상세에 리뷰와 저장 버튼의 인증을 끼운다. 도메인끼리는 import하지 않으므로 app이 조합한다(리뷰 D-32, 북마크 D-5)
export function PlaceDetailWithReviews({
  placeId,
  fromSaved,
  fit,
}: {
  placeId: number;
  fromSaved: boolean;
  // 모임에서 열었을 때 모임 결과의 점수와 추천 이유
  fit?: PlaceFit;
}) {
  const router = useRouter();
  const bookmarks = useBookmarkAccess();
  const editReview = (placeId: number) => (reviewId: number) =>
    router.push(reviewEditHref(placeId, reviewId));
  // 로그인 화면의 "뒤로"가 장소 상세로 돌아오게 쌓고, 로그인한 뒤 이 장소 상세로 돌아오게 주소를 남긴다(리뷰 D-48)
  const signIn = () => {
    rememberLoginReturn(window.location.pathname + window.location.search);
    router.push("/login");
  };
  return (
    <PlaceDetailScreen
      placeId={placeId}
      fromSaved={fromSaved}
      fit={fit}
      bookmarks={bookmarks}
      slots={{
        homeReviews: (placeId, showReviews) => (
          <ReviewSection
            placeId={placeId}
            onShowAll={showReviews}
            withOptionalSession={withOptionalSession}
            authenticated={authenticated}
            onEdit={editReview(placeId)}
            onSignIn={signIn}
          />
        ),
        reviewTab: (placeId) => (
          <ReviewSection
            placeId={placeId}
            withOptionalSession={withOptionalSession}
            authenticated={authenticated}
            onEdit={editReview(placeId)}
            onSignIn={signIn}
          />
        ),
        bottomAction: (placeId) => (
          <ReviewEntryButton
            placeId={placeId}
            authenticated={authenticated}
            onEnter={() => router.push(reviewWriteHref(placeId))}
            onSignIn={signIn}
          />
        ),
      }}
    />
  );
}
