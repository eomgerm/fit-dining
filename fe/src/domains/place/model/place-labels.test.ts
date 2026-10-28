import { describe, expect, it } from "vitest";

import { facilityIconGroup, missingEvidenceNotes } from "./place-labels";

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

describe("missingEvidenceNotes", () => {
  it("점수에 넣지 못한 항목마다 출처에 맞춘 안내를 만든다", () => {
    expect(
      missingEvidenceNotes([
        {
          source: "REQUEST",
          label: "대화하기 좋은",
          matched: true,
          evidenceCount: 12,
        },
        {
          source: "PREFERENCE",
          label: "아늑한 곳",
          matched: false,
          evidenceCount: 0,
        },
        { source: "REQUEST", label: "주차", matched: false, evidenceCount: 1 },
      ]),
    ).toEqual([
      "이 장소는 ‘아늑한 곳’ 취향을 확인할 근거가 부족해요",
      "이 장소는 ‘주차’ 요청을 확인할 근거가 부족해요",
    ]);
  });

  it("모두 반영됐으면 안내가 없다", () => {
    expect(
      missingEvidenceNotes([
        { source: "REQUEST", label: "조용한", matched: true, evidenceCount: 3 },
      ]),
    ).toEqual([]);
  });
});
