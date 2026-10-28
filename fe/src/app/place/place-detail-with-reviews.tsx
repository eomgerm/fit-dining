"use client";

import { useRouter } from "next/navigation";

import { withAccessToken } from "@/domains/auth/api/with-access-token";
import { PlaceDetailScreen } from "@/domains/place/ui/place-detail-screen";
import { reviewWriteHref } from "@/domains/review/model/review";
import { ReviewEntryButton } from "@/domains/review/ui/review-entry-button";
import { ReviewSection } from "@/domains/review/ui/review-section";

import { withOptionalAccessToken } from "./with-optional-access-token";

// 장소 상세에 리뷰를 끼운다. 도메인끼리는 import하지 않으므로 app이 조합한다(리뷰 D-32)
export function PlaceDetailWithReviews() {
  const router = useRouter();
  return (
    <PlaceDetailScreen
      slots={{
        homeReviews: (placeId, showReviews) => (
          <ReviewSection
            placeId={placeId}
            onShowAll={showReviews}
            withOptionalAccessToken={withOptionalAccessToken}
          />
        ),
        reviewTab: (placeId) => (
          <ReviewSection
            placeId={placeId}
            withOptionalAccessToken={withOptionalAccessToken}
          />
        ),
        bottomAction: (placeId) => (
          <ReviewEntryButton
            placeId={placeId}
            withAccessToken={withAccessToken}
            onEnter={() => router.push(reviewWriteHref(placeId))}
          />
        ),
      }}
    />
  );
}
