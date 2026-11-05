import type { Metadata } from "next";

import { placeDetailHref } from "@/domains/place/model/bookmark";
import { CATEGORY_LABELS } from "@/domains/place/model/place-labels";
import type {
  CategoryGroup,
  DayCode,
  Hours,
  PlaceDetail,
} from "@/domains/place/model/place-types";

import { siteOpenGraph, siteUrl } from "../../site";

// 제목은 레이아웃의 "%s | 핏다이닝" 템플릿이 감싼다
export function placeMetadata(detail: PlaceDetail): Metadata {
  const { name, id } = detail.place;
  const description = detail.description ?? fallbackDescription(detail);
  // ?from=saved 같은 화면 상태는 canonical에서 뺀다
  const url = placeDetailHref(id);
  return {
    title: name,
    description,
    alternates: { canonical: url },
    // 정하면 루트 opengraph-image.png보다 앞선다. 상대 주소는 metadataBase가 사이트 주소로 바꾼다
    openGraph: {
      ...siteOpenGraph,
      title: name,
      description,
      url,
      ...(detail.photos.length > 0 && { images: [detail.photos[0]] }),
    },
  };
}

function fallbackDescription({ place, address }: PlaceDetail) {
  const category = CATEGORY_LABELS[place.categoryGroup];
  return address ? `${category} · ${address}` : category;
}

const SCHEMA_TYPES: Record<CategoryGroup, string> = {
  RESTAURANT: "Restaurant",
  CAFE: "CafeOrCoffeeShop",
  BAR: "BarOrPub",
};

const SCHEMA_DAYS: Record<DayCode, string> = {
  MON: "Monday",
  TUE: "Tuesday",
  WED: "Wednesday",
  THU: "Thursday",
  FRI: "Friday",
  SAT: "Saturday",
  SUN: "Sunday",
};

// schema.org 식당 구조화 데이터. <script>에 그대로 넣도록 <를 이스케이프한 JSON 문자열이다(Next JSON-LD 가이드)
export function placeJsonLd(detail: PlaceDetail) {
  const { place, address, photos, phone } = detail;
  const openingHours = detail.hours.flatMap(openingHoursSpecification);
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": SCHEMA_TYPES[place.categoryGroup],
    name: place.name,
    url: siteUrl + placeDetailHref(place.id),
    ...(photos.length > 0 && {
      image: photos.map((photo) => new URL(photo, siteUrl).href),
    }),
    ...(address && {
      address: {
        "@type": "PostalAddress",
        streetAddress: address,
        addressCountry: "KR",
      },
    }),
    geo: {
      "@type": "GeoCoordinates",
      latitude: place.lat,
      longitude: place.lng,
    },
    ...(phone && { telephone: phone }),
    ...(openingHours.length > 0 && {
      openingHoursSpecification: openingHours,
    }),
  };
  return JSON.stringify(jsonLd).replace(/</g, "\\u003c");
}

// 브레이크타임으로 나눈 영업 구간마다 하나. 닫는 시각이 여는 시각보다 이르면 다음 날 닫는다는 뜻이다(schema.org)
function openingHoursSpecification({
  dayOfWeek,
  open,
  close,
  closed,
  breaks,
}: Hours) {
  if (closed || !open || !close) return [];
  // 화면은 00:00 – 00:00을 24시간 영업으로 읽고, Google은 같은 00:00을 하루 휴무로 읽는다
  if (open === "00:00" && close === "00:00") close = "23:59";
  const edges = [
    open,
    ...breaks.flatMap(({ start, end }) => [start, end]),
    close,
  ];
  const spans = [];
  for (let i = 0; i < edges.length; i += 2) {
    spans.push({
      "@type": "OpeningHoursSpecification",
      dayOfWeek: `https://schema.org/${SCHEMA_DAYS[dayOfWeek]}`,
      opens: edges[i],
      closes: edges[i + 1],
    });
  }
  return spans;
}
