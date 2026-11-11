import {
  dehydrate,
  HydrationBoundary,
  QueryClient,
} from "@tanstack/react-query";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { placeQueries } from "@/domains/place/api/place-queries";
import { SAVED_VIEW } from "@/domains/place/model/bookmark";
import { parsePlaceId } from "@/domains/place/model/place-id";

import { loadPlace } from "./load-place";
import { MeetupPlaceDetail } from "./meetup-place-detail";
import { PlaceDetailWithReviews } from "./place-detail-with-reviews";
import { placeJsonLd, placeMetadata } from "./place-seo";

type Props = PageProps<"/places/[id]">;

// 장소마다 제목·설명·canonical·공유 이미지를 둔다. 페이지와 같은 요청 안에서 BE는 한 번만 부른다(loadPlace).
// 잘못된 id·없는 장소는 페이지의 notFound()가 noindex를 붙이고, 실패면 레이아웃 메타데이터를 그대로 쓴다
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const id = parsePlaceId((await params).id);
  if (id === undefined) return {};
  const place = await loadPlace(id);
  return typeof place === "object" ? placeMetadata(place) : {};
}

// 크롤러와 JS를 끈 사용자도 장소 내용을 읽도록 상세를 서버에서 읽어 캐시에 넣고 그린다.
// Suspense로 감싸면 본문이 hidden div로 스트리밍되어 JS 없이는 보이지 않는다. 그래서 BE 응답까지 기다려
// 한 번에 그리고, 이 경로로의 이동은 그만큼 기다린다. 루트 레이아웃은 정적 껍데기로 먼저 나가므로
// notFound()는 404가 아니라 200과 noindex이고 not-found 화면은 브라우저가 그린다(검색 D-106)
export const instant = false;

export default async function PlaceDetailPage({ params, searchParams }: Props) {
  const id = parsePlaceId((await params).id);
  if (id === undefined) notFound();
  const place = await loadPlace(id);
  if (place === "not-found") notFound();
  // BE가 잠시 실패했으면 비워 두고 브라우저가 다시 받는다
  const queryClient = new QueryClient();
  const loaded = place !== "failed";
  if (loaded) queryClient.setQueryData(placeQueries.detail(id).queryKey, place);
  const { from, meetup } = await searchParams;
  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      {loaded && (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: placeJsonLd(place) }}
        />
      )}
      {typeof meetup === "string" ? (
        <MeetupPlaceDetail code={meetup} placeId={id} />
      ) : (
        <PlaceDetailWithReviews placeId={id} fromSaved={from === SAVED_VIEW} />
      )}
    </HydrationBoundary>
  );
}
