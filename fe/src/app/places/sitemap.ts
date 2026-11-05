import type { MetadataRoute } from "next";
import { connection } from "next/server";

import { getPlaceIds } from "@/domains/place/api/place-api";
import { placeDetailHref } from "@/domains/place/model/bookmark";

import { siteUrl } from "../site";

// /places/sitemap.xml. 빌드 환경에는 BE가 없고 장소는 배포 없이 늘어나므로 요청마다 BE에서 읽는다.
// lastModified는 싣지 않는다. places.updated_at은 재수집 때마다 바뀌어 실제 변경 시각이 아니다
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  await connection();
  const ids = await getPlaceIds();
  return ids.map((id) => ({ url: siteUrl + placeDetailHref(id) }));
}
