import { describe, expect, it } from "vitest";

import {
  formatKstDate,
  parsePlaceId,
  reviewWriteHref,
  toCreateRequest,
} from "./review";

describe("formatKstDate", () => {
  it("BE가 보낸 KST 오프셋 시각을 Figma처럼 월·일로 보인다", () => {
    expect(formatKstDate("2026-10-20T15:00:00+09:00")).toBe("10월 20일");
    expect(formatKstDate("2026-10-08T09:00:00+09:00")).toBe("10월 8일");
  });

  it("UTC 15시는 KST로 다음 날 0시라 날짜가 바뀐다", () => {
    expect(formatKstDate("2026-10-20T14:59:59Z")).toBe("10월 20일");
    expect(formatKstDate("2026-10-20T15:00:00Z")).toBe("10월 21일");
  });
});

describe("toCreateRequest", () => {
  it("공백뿐이면 본문 없이 보낸다", () => {
    expect(toCreateRequest("")).toEqual({});
    expect(toCreateRequest(" \n\t ")).toEqual({});
  });

  it("내용이 있으면 앞뒤 공백까지 그대로 보낸다", () => {
    expect(toCreateRequest(" 좋았어요\n")).toEqual({
      description: " 좋았어요\n",
    });
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
