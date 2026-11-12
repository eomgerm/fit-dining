import { describe, expect, it } from "vitest";

import {
  facilityIconGroup,
  matchedLabels,
  reasonAuthor,
  visitedDay,
} from "./place-labels";

describe("facilityIconGroup", () => {
  it.each([
    ["주차", "parking"],
    ["발렛파킹", "parking"],
    ["장애인 주차구역", "parking"],
    ["무선 인터넷", "wifi"],
    ["단체 이용 가능", "group"],
    ["예약", "reservation"],
    ["포장", "takeout"],
    ["배달", "takeout"],
    ["테이크아웃 할인", "takeout"],
    ["남/녀 화장실 구분", "restroom"],
    ["유아의자", "kids"],
    ["키즈메뉴", "kids"],
    ["노키즈존", "kids"],
    ["출입구 휠체어 이용가능", "wheelchair"],
    ["좌석 휠체어 이용가능", "wheelchair"],
    ["화장실 휠체어 이용가능", "wheelchair"],
    ["반려동물 동반", "pet"],
    ["비건 메뉴", "menu"],
    ["글루텐프리 메뉴", "menu"],
    ["유기농 메뉴", "menu"],
    ["무한 리필", "menu"],
    ["와인 페어링", "menu"],
  ])("'%s'는 %s 묶음이다", (name, group) => {
    expect(facilityIconGroup(name)).toBe(group);
  });

  it.each(["간편결제", "대기공간", "처음 보는 시설", "constructor"])(
    "묶음에 없는 '%s'는 기본 아이콘이다",
    (name) => {
      expect(facilityIconGroup(name)).toBeUndefined();
    },
  );
});

describe("reasonAuthor, visitedDay", () => {
  it("추천 이유 근거 리뷰는 리뷰 탭처럼 작성자와 방문일을 쓴다", () => {
    expect(reasonAuthor({ nickname: "밥친구" })).toBe("밥친구");
    expect(reasonAuthor({})).toBe("탈퇴한 회원");
    expect(visitedDay("2026-11-01")).toBe("11월 1일 방문");
  });
});

describe("matchedLabels", () => {
  const item = (label: string, matched: boolean) => ({
    source: "PREFERENCE" as const,
    label,
    matched,
    evidenceCount: 2,
  });

  it("matched인 항목의 문구만 모은다", () => {
    const labels = matchedLabels([
      item("조용해요", true),
      item("넓어요", false),
    ]);

    expect(labels.has("조용해요")).toBe(true);
    expect(labels.has("넓어요")).toBe(false);
  });

  it("항목이 없으면 비어 있다", () => {
    expect(matchedLabels([]).size).toBe(0);
  });
});
