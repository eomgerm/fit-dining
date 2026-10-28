import { describe, expect, it } from "vitest";

import {
  authorLabel,
  formatVisitedDay,
  parsePlaceId,
  reviewWriteHref,
} from "./review";

describe("formatVisitedDay", () => {
  it("방문일을 Figma 6-03처럼 월·일과 '방문'으로 보인다", () => {
    expect(formatVisitedDay("2026-10-12")).toBe("10월 12일 방문");
    expect(formatVisitedDay("2026-01-08")).toBe("1월 8일 방문");
  });
});

describe("authorLabel", () => {
  it("닉네임을 보이고, 닉네임이 없으면 탈퇴한 회원이다", () => {
    expect(authorLabel({ nickname: "밤산책" })).toBe("밤산책");
    expect(authorLabel({})).toBe("탈퇴한 회원");
  });
});

describe("parsePlaceId", () => {
  it("양의 정수만 장소 id로 쓴다", () => {
    expect(parsePlaceId("1")).toBe(1);
    expect(parsePlaceId("30")).toBe(30);
  });

  it.each([null, "", "0", "-1", "01", "1.5", "abc", "9007199254740992"])(
    "%s는 장소 id가 아니다",
    (value) => {
      expect(parsePlaceId(value)).toBeNull();
    },
  );
});

describe("reviewWriteHref", () => {
  it("장소 상세 주소 규칙을 따른다", () => {
    expect(reviewWriteHref(7)).toBe("/place/review?id=7");
  });
});
