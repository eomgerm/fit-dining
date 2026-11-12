import { describe, expect, it } from "vitest";

import {
  formatDate,
  formatTime,
  formatWhen,
  isSelectable,
  kstToday,
  selectableRange,
} from "./meetup-date";

// 2026-11-11 23:59:30 KST와 2026-11-12 00:00:30 KST. UTC로는 둘 다 11일이다
const BEFORE_MIDNIGHT = new Date("2026-11-11T14:59:30Z");
const AFTER_MIDNIGHT = new Date("2026-11-11T15:00:30Z");

describe("모임 날짜 표기", () => {
  it("날짜는 월, 일, 요일로 쓴다", () => {
    expect(formatDate("2026-11-13")).toBe("11월 13일 (금)");
  });

  it("시간 고르기 칸은 때와 12시간제 시각으로 쓴다", () => {
    expect(formatTime("19:00")).toBe("저녁 7:00");
    expect(formatTime("12:30")).toBe("오후 12:30");
    expect(formatTime("00:10")).toBe("새벽 12:10");
    expect(formatTime("09:05")).toBe("오전 9:05");
    expect(formatTime("22:00")).toBe("밤 10:00");
  });

  it("모임 정보는 날짜와 때와 시를 쓴다", () => {
    expect(formatWhen("2026-11-13", "19:00")).toBe("11월 13일 (금) 저녁 7시");
    expect(formatWhen("2026-11-13", "19:30")).toBe(
      "11월 13일 (금) 저녁 7시 30분",
    );
    expect(formatWhen("2026-11-13")).toBe("11월 13일 (금)");
  });
});

describe("고를 수 있는 날짜", () => {
  it("오늘은 KST로 정한다", () => {
    expect(kstToday(BEFORE_MIDNIGHT)).toBe("2026-11-11");
    expect(kstToday(AFTER_MIDNIGHT)).toBe("2026-11-12");
  });

  it("오늘부터 30일 뒤까지 고른다", () => {
    expect(selectableRange(BEFORE_MIDNIGHT)).toEqual({
      min: "2026-11-11",
      max: "2026-12-11",
    });
    expect(isSelectable("2026-12-11", undefined, BEFORE_MIDNIGHT)).toBe(true);
    expect(isSelectable("2026-12-12", undefined, BEFORE_MIDNIGHT)).toBe(false);
    expect(isSelectable("2026-11-11", undefined, AFTER_MIDNIGHT)).toBe(false);
  });

  it("오늘인데 지난 시각이면 고를 수 없고, 시각만 있어도 고를 수 없다", () => {
    expect(isSelectable("2026-11-11", "23:59", BEFORE_MIDNIGHT)).toBe(false);
    expect(isSelectable("2026-11-12", "00:00", BEFORE_MIDNIGHT)).toBe(true);
    expect(isSelectable(undefined, "19:00", BEFORE_MIDNIGHT)).toBe(false);
    expect(isSelectable(undefined, undefined, BEFORE_MIDNIGHT)).toBe(true);
  });
});
