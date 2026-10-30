"use client";

import { useRouter } from "next/navigation";

import { withAccessToken } from "@/domains/auth/api/with-access-token";
import { PlaceDetailScreen } from "@/domains/place/ui/place-detail-screen";
import { reviewEditHref, reviewWriteHref } from "@/domains/review/model/review";
import { ReviewEntryButton } from "@/domains/review/ui/review-entry-button";
import { ReviewSection } from "@/domains/review/ui/review-section";

import { useBookmarkAccess } from "../use-bookmark-access";
import { withOptionalAccessToken } from "./with-optional-access-token";

// 장소 상세에 리뷰와 저장 버튼의 인증을 끼운다. 도메인끼리는 import하지 않으므로 app이 조합한다(리뷰 D-32, 북마크 D-5)
export function PlaceDetailWithReviews() {
  const router = useRouter();
  const bookmarks = useBookmarkAccess();
  const editReview = (placeId: number) => (reviewId: number) =>
    router.push(reviewEditHref(placeId, reviewId));
  // 로그인 화면의 "뒤로"가 장소 상세로 돌아오게 쌓는다. 로그인 뒤 이 화면으로 돌아오는 것은 아직 없다
  const signIn = () => router.push("/login");
  return (
    <PlaceDetailScreen
      bookmarks={bookmarks}
      slots={{
        homeReviews: (placeId, showReviews) => (
          <ReviewSection
            placeId={placeId}
            onShowAll={showReviews}
            withOptionalAccessToken={withOptionalAccessToken}
            withAccessToken={withAccessToken}
            onEdit={editReview(placeId)}
            onSignIn={signIn}
          />
        ),
        reviewTab: (placeId) => (
          <ReviewSection
            placeId={placeId}
            withOptionalAccessToken={withOptionalAccessToken}
            withAccessToken={withAccessToken}
            onEdit={editReview(placeId)}
            onSignIn={signIn}
          />
        ),
        bottomAction: (placeId) => (
          <ReviewEntryButton
            placeId={placeId}
            withAccessToken={withAccessToken}
            onEnter={() => router.push(reviewWriteHref(placeId))}
            onSignIn={signIn}
          />
        ),
      }}
    />
  );
}
