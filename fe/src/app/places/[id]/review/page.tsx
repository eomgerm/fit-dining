import { notFound } from "next/navigation";

import { parsePlaceId, parseVisitedOn } from "@/domains/review/model/review";

import { ReviewWriteScreen } from "./review-write-screen";

// 주소를 검사하는 동안 기다려도 된다. 화면은 세션을 확인한 뒤 브라우저에서 그린다
export const instant = false;

// 리뷰 작성 화면(/places/<장소 id>/review). id가 잘못되면 장소 not-found다
export default async function ReviewWritePage({
  params,
  searchParams,
}: PageProps<"/places/[id]/review">) {
  const placeId = parsePlaceId((await params).id);
  if (placeId === null) notFound();
  const visitedOn = parseVisitedOn((await searchParams).visited);
  return <ReviewWriteScreen placeId={placeId} visitedOn={visitedOn} />;
}
