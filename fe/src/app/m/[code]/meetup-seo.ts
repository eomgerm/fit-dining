import type { Metadata } from "next";

import { areaLabel } from "@/domains/meetup/model/meetup";
import { formatWhen } from "@/domains/meetup/model/meetup-date";

import { siteImage, siteOpenGraph } from "../../site";
import type { LoadedPreview } from "./load-preview";

// 브라우저 탭의 제목. 레이아웃의 "%s | 핏다이닝" 템플릿이 감싼다
const PAGE_TITLE = "모임 장소 정하기";
const JOIN_NOTE = "가입 없이 몇 가지만 답하면 돼요";
// 없는 모임이나 읽지 못했을 때의 일반 안내. 모임 정보를 싣지 않는다
const GENERAL_TITLE = "핏다이닝 모임 장소 정하기";
const GENERAL_DESCRIPTION = "친구들과 갈 곳을 같이 정해요.";

// 모임 링크의 미리보기 메타 태그(AC-66, 화면 예시 참여자 1). 모임장 닉네임, 지역, 날짜·시간, 가입 없이 답할 수 있다는
// 안내만 싣는다. 질문 개수, 모임 취향, 참여자 이름은 싣지 않는다. 이미지는 서비스 기본 이미지다.
// 검색 제외와 no-referrer는 /m 레이아웃이 건다
export function meetupMetadata(preview: LoadedPreview): Metadata {
  if (preview === "not-found" || preview === "failed") {
    return share(GENERAL_TITLE, GENERAL_DESCRIPTION);
  }
  const title = preview.hostNickname
    ? `${preview.hostNickname}님이 모임 장소를 같이 정하자고 해요`
    : "모임 장소를 같이 정하자고 해요";
  const area = areaLabel(preview.area);
  const when = preview.date ? formatWhen(preview.date, preview.time) : "";
  const description = [area, when, JOIN_NOTE].filter(Boolean).join(" · ");
  return share(title, description);
}

function share(title: string, description: string): Metadata {
  return {
    title: PAGE_TITLE,
    description,
    openGraph: { ...siteOpenGraph, title, description, images: [siteImage] },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [siteImage],
    },
  };
}
