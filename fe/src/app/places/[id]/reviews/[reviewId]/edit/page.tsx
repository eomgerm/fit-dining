import { notFound } from "next/navigation";

import { parsePlaceId, parseReviewId } from "@/domains/review/model/review";

import { ReviewEditScreen } from "./review-edit-screen";

// 주소를 검사하는 동안 기다려도 된다. 화면은 세션을 확인한 뒤 브라우저에서 그린다
export const instant = false;

// 리뷰 수정 화면(/places/<장소 id>/reviews/<리뷰 id>/edit). id가 잘못되면 리뷰 not-found다
export default async function ReviewEditPage({
  params,
}: PageProps<"/places/[id]/reviews/[reviewId]/edit">) {
  const { id, reviewId } = await params;
  const placeId = parsePlaceId(id);
  const review = parseReviewId(reviewId);
  if (placeId === null || review === null) notFound();
  return <ReviewEditScreen placeId={placeId} reviewId={review} />;
}
