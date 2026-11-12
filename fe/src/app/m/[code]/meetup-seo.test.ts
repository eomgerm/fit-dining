import { describe, expect, it } from "vitest";

import { siteImage } from "../../site";
import { meetupMetadata } from "./meetup-seo";

describe("모임 링크 미리보기", () => {
  it("모임장 닉네임, 지역, 날짜·시간과 가입 없이 답한다는 안내만 싣는다", () => {
    const metadata = meetupMetadata({
      hostNickname: "민지",
      area: { kind: "STATION", name: "선릉" },
      date: "2026-11-14",
      time: "19:00",
    });

    expect(metadata.openGraph).toMatchObject({
      siteName: "핏다이닝",
      title: "민지님이 모임 장소를 같이 정하자고 해요",
      description:
        "선릉역 · 11월 14일 (토) 저녁 7시 · 가입 없이 몇 가지만 답하면 돼요",
    });
    expect(metadata.description).toBe(
      "선릉역 · 11월 14일 (토) 저녁 7시 · 가입 없이 몇 가지만 답하면 돼요",
    );
    // openGraph를 정하면 파일 규칙 이미지가 빠지므로 서비스 기본 이미지를 직접 싣는다
    expect(metadata.openGraph).toMatchObject({ images: [siteImage] });
    expect(metadata.twitter).toMatchObject({ images: [siteImage] });
    expect(metadata.title).toBe("모임 장소 정하기");
  });

  it("날짜가 없거나 지점 모임이면 있는 것만 싣는다", () => {
    expect(
      meetupMetadata({
        hostNickname: "민지",
        area: { kind: "POINT", name: "회사 앞" },
      }).description,
    ).toBe("회사 앞 · 가입 없이 몇 가지만 답하면 돼요");
    expect(meetupMetadata({ area: { kind: "POINT" } }).openGraph).toMatchObject(
      {
        title: "모임 장소를 같이 정하자고 해요",
        description: "가입 없이 몇 가지만 답하면 돼요",
      },
    );
  });

  it("없는 모임이나 읽지 못하면 모임 정보 없는 일반 안내다", () => {
    for (const preview of ["not-found", "failed"] as const) {
      expect(meetupMetadata(preview).openGraph).toMatchObject({
        title: "핏다이닝 모임 장소 정하기",
        description: "친구들과 갈 곳을 같이 정해요.",
        images: [siteImage],
      });
    }
  });
});
