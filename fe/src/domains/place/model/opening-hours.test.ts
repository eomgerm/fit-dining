import { describe, expect, it } from "vitest";

import {
  hoursNotes,
  hoursText,
  seoulNow,
  todayHours,
  todayNotice,
} from "./opening-hours";
import type { DayCode, Hours } from "./place-types";

// 2026-10-22는 목요일이다. 한국 시각 = UTC + 9
const seoul = (time: string, date = "2026-10-22") =>
  new Date(`${date}T${time}:00+09:00`);

const day = (dayOfWeek: DayCode, overrides: Partial<Hours> = {}): Hours => ({
  dayOfWeek,
  open: "11:00",
  close: "22:00",
  breakStart: "15:00",
  breakEnd: "17:00",
  lastOrders: ["14:30", "21:00"],
  closed: false,
  ...overrides,
});

const week = (thursday: Partial<Hours> = {}) =>
  (["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as DayCode[]).map((d) =>
    day(d, d === "THU" ? thursday : {}),
  );

describe("seoulNow", () => {
  it("기기 시간대와 관계없이 한국 시각의 요일과 HH:mm이다", () => {
    expect(seoulNow(new Date("2026-10-22T15:30:00Z"))).toEqual({
      day: "FRI",
      time: "00:30",
    });
  });
});

describe("todayHours", () => {
  it("한국 시각 기준 오늘의 영업시간을 고른다", () => {
    expect(todayHours(week(), seoul("10:00"))?.dayOfWeek).toBe("THU");
  });
});

describe("todayNotice", () => {
  it("영업 중이거나 곧 마감이면 '오늘 <close>까지'다", () => {
    expect(todayNotice(week(), "OPEN", seoul("12:00"))).toBe("오늘 22:00까지");
    expect(todayNotice(week(), "CLOSING_SOON", seoul("21:30"))).toBe(
      "오늘 22:00까지",
    );
  });

  it("브레이크타임이면 '<breakEnd>에 다시 열어요'다", () => {
    expect(todayNotice(week(), "BREAK", seoul("15:30"))).toBe(
      "17:00에 다시 열어요",
    );
  });

  it("개점 전이면 '<open>에 열어요'다", () => {
    expect(todayNotice(week(), "CLOSED", seoul("09:00"))).toBe(
      "11:00에 열어요",
    );
  });

  it("마감 뒤에는 안내가 없다", () => {
    expect(todayNotice(week(), "CLOSED", seoul("22:00"))).toBeUndefined();
  });

  it("휴무일이면 '오늘 휴무'다", () => {
    const closed = week({
      closed: true,
      open: undefined,
      close: undefined,
      breakStart: undefined,
      breakEnd: undefined,
      lastOrders: [],
    });
    expect(todayNotice(closed, "CLOSED", seoul("12:00"))).toBe("오늘 휴무");
  });

  it("영업 상태를 모르면 안내가 없다", () => {
    expect(todayNotice(week(), "UNKNOWN", seoul("12:00"))).toBeUndefined();
  });
});

describe("hoursText", () => {
  it("영업시간을 '11:00 – 22:00'으로 보여 준다", () => {
    expect(hoursText(day("MON"))).toBe("11:00 – 22:00");
  });

  it("휴무일은 '휴무'다", () => {
    expect(hoursText(day("MON", { closed: true }))).toBe("휴무");
  });
});

describe("hoursNotes", () => {
  it("브레이크타임과 라스트오더를 한 줄씩 보여 준다", () => {
    expect(hoursNotes(day("MON"))).toEqual([
      "15:00 – 17:00 브레이크타임",
      "14:30, 21:00 라스트오더",
    ]);
  });

  it("없는 줄은 빼고, 휴무일은 아무 줄도 없다", () => {
    expect(
      hoursNotes(day("MON", { breakStart: undefined, breakEnd: undefined })),
    ).toEqual(["14:30, 21:00 라스트오더"]);
    expect(hoursNotes(day("MON", { lastOrders: [] }))).toEqual([
      "15:00 – 17:00 브레이크타임",
    ]);
    expect(hoursNotes(day("MON", { closed: true }))).toEqual([]);
  });
});
