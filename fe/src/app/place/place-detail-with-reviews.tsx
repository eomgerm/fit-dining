"use client";

import Link from "next/link";

import { PlaceDetailScreen } from "@/domains/place/ui/place-detail-screen";
import { reviewWriteHref } from "@/domains/review/model/review";
import { ReviewSection } from "@/domains/review/ui/review-section";
import { Button } from "@/shared/ui/button/button";

import { withOptionalAccessToken } from "./with-optional-access-token";

// 장소 상세에 리뷰를 끼운다. 도메인끼리는 import하지 않으므로 app이 조합한다(리뷰 D-32)
export function PlaceDetailWithReviews() {
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
          <Button
            render={<Link href={reviewWriteHref(placeId)} />}
            nativeButton={false}
            className="w-full"
          >
            방문 평가 남기기
          </Button>
        ),
      }}
    />
  );
}
