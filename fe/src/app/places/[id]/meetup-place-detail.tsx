"use client";

import {
  useMeetupResult,
  useMeetupSnapshot,
} from "@/domains/meetup/api/queries";
import { isMeetupCode } from "@/domains/meetup/model/meetup";
import type { MeetupResultItem } from "@/domains/meetup/model/result";
import type { PlaceFit } from "@/domains/place/model/place-types";

import { PlaceDetailWithReviews } from "./place-detail-with-reviews";

// 모임 결과를 받기 전이나 그 장소가 결과에 없을 때. 개인 검색 점수를 쓰지 않도록 빈 값을 넘긴다
const NO_FIT: PlaceFit = { reasons: [] };

function toFit(item: MeetupResultItem): PlaceFit {
  return {
    score: item.score,
    caution: item.caution,
    reasons: item.reasons.map((reason) => ({
      title: reason.title,
      tags: reason.tags ?? [],
      quote: reason.quote,
      quoteSource: reason.quoteSource,
    })),
  };
}

function WithMeetupResult({
  code,
  placeId,
}: {
  code: string;
  placeId: number;
}) {
  const snapshot = useMeetupSnapshot(code);
  const result = useMeetupResult(code, snapshot.data?.resultCalculationId);
  const item = result.data?.items.find(({ place }) => place.id === placeId);
  return (
    <PlaceDetailWithReviews
      placeId={placeId}
      fromSaved={false}
      fit={item ? toFit(item) : NO_FIT}
    />
  );
}

// 모임에서 연 장소 상세(/places/{id}?meetup={code}). 모임 점수와 추천 이유를 보이고 개인 검색 점수는 보이지 않는다.
// 주소를 직접 열어도 같다(AC-33, D-22)
export function MeetupPlaceDetail({
  code,
  placeId,
}: {
  code: string;
  placeId: number;
}) {
  if (!isMeetupCode(code)) {
    return (
      <PlaceDetailWithReviews
        placeId={placeId}
        fromSaved={false}
        fit={NO_FIT}
      />
    );
  }
  return <WithMeetupResult code={code} placeId={placeId} />;
}
