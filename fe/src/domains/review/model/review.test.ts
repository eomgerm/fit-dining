import { describe, expect, it } from "vitest";

import {
  authorLabel,
  formatVisitedDay,
  isDescriptionChanged,
  parsePlaceId,
  parseReviewId,
  reportRequest,
  reviewEditHref,
  reviewWriteHref,
} from "./review";

describe("reportRequest", () => {
  it("설명은 '기타'일 때만 보낸다", () => {
    expect(reportRequest("OTHER", "홍보 글이에요")).toEqual({
      reason: "OTHER",
      detail: "홍보 글이에요",
    });
    expect(reportRequest("AD_SPAM", "홍보 글이에요")).toEqual({
      reason: "AD_SPAM",
    });
  });

  it("공백뿐인 설명은 보내지 않는다", () => {
    expect(reportRequest("OTHER", " \n")).toEqual({ reason: "OTHER" });
  });
});

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

describe("reviewEditHref", () => {
  it("id는 장소 id로 두고 리뷰 id는 review로 싣는다", () => {
    expect(reviewEditHref(3, 12)).toBe("/place/review/edit?id=3&review=12");
  });
});

describe("parseReviewId", () => {
  it("장소 id와 같이 양의 정수만 받는다", () => {
    expect(parseReviewId("12")).toBe(12);
    expect(parseReviewId("0")).toBeNull();
    expect(parseReviewId(null)).toBeNull();
  });
});

describe("isDescriptionChanged", () => {
  it("저장된 본문과 다르면 바뀐 것이다", () => {
    expect(isDescriptionChanged("국물이 진해요", "국물이 진해요!")).toBe(true);
    expect(isDescriptionChanged(undefined, "새로 쓴 본문")).toBe(true);
    expect(isDescriptionChanged("국물이 진해요", "")).toBe(true);
  });

  it("같거나, 본문 없음과 공백뿐인 입력이면 바뀌지 않은 것이다", () => {
    expect(isDescriptionChanged("국물이 진해요", "국물이 진해요")).toBe(false);
    expect(isDescriptionChanged(undefined, "")).toBe(false);
    expect(isDescriptionChanged(undefined, "  ")).toBe(false);
  });
});
