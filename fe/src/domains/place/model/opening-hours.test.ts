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

const DAYS: DayCode[] = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

const day = (dayOfWeek: DayCode, overrides: Partial<Hours> = {}): Hours => ({
  dayOfWeek,
  open: "11:00",
  close: "22:00",
  breaks: [{ start: "15:00", end: "17:00" }],
  lastOrders: ["14:30", "21:00"],
  closed: false,
  ...overrides,
});

const closedDay: Partial<Hours> = {
  closed: true,
  open: undefined,
  close: undefined,
  breaks: [],
  lastOrders: [],
};

const unknownDay: Partial<Hours> = {
  open: undefined,
  close: undefined,
  breaks: [],
  lastOrders: [],
};

const week = (
  thursday: Partial<Hours> = {},
  others: Partial<Record<DayCode, Partial<Hours>>> = {},
) => DAYS.map((d) => day(d, d === "THU" ? thursday : (others[d] ?? {})));

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

  it("마감이 00:00이면 '오늘 24:00까지'다", () => {
    const midnight = week({ open: "18:00", close: "00:00", breaks: [] });
    expect(todayNotice(midnight, "OPEN", seoul("20:00"))).toBe(
      "오늘 24:00까지",
    );
  });

  it("오늘 구간이 자정을 넘으면 '내일 <close>까지'다", () => {
    const overnight = week({ open: "17:00", close: "02:00", breaks: [] });
    expect(todayNotice(overnight, "OPEN", seoul("20:00"))).toBe(
      "내일 02:00까지",
    );
    expect(todayNotice(overnight, "OPEN", seoul("23:30"))).toBe(
      "내일 02:00까지",
    );
  });

  it("지금이 어제 구간의 새벽 부분이면 '<close>까지'이고, 오늘이 휴무여도 '오늘 휴무'가 아니다", () => {
    const hours = week(closedDay, {
      WED: { open: "17:00", close: "02:00", breaks: [] },
    });
    expect(todayNotice(hours, "CLOSING_SOON", seoul("01:30"))).toBe(
      "02:00까지",
    );
    expect(todayNotice(hours, "OPEN", seoul("00:30"))).toBe("02:00까지");
    // 어제 구간이 끝난 뒤에는 오늘 줄을 본다
    expect(todayNotice(hours, "CLOSED", seoul("03:00"))).toBe("오늘 휴무");
  });

  it("어제 구간의 새벽 부분에서 브레이크면 그 브레이크의 끝으로 안내한다", () => {
    const hours = week(closedDay, {
      WED: {
        open: "18:00",
        close: "04:00",
        breaks: [{ start: "00:30", end: "01:00" }],
      },
    });
    expect(todayNotice(hours, "BREAK", seoul("00:45"))).toBe(
      "01:00에 다시 열어요",
    );
  });

  it("오늘이 24시간이면 다음 날도 00:00에 열 때 '24시간 영업', 아니면 '오늘 24:00까지'다", () => {
    const allWeek = DAYS.map((d) =>
      day(d, { open: "00:00", close: "00:00", breaks: [], lastOrders: [] }),
    );
    expect(todayNotice(allWeek, "OPEN", seoul("23:30"))).toBe("24시간 영업");

    const thursdayOnly = week(
      { open: "00:00", close: "00:00", breaks: [] },
      { FRI: closedDay },
    );
    expect(todayNotice(thursdayOnly, "CLOSING_SOON", seoul("23:30"))).toBe(
      "오늘 24:00까지",
    );
  });

  it("브레이크타임이면 지금 들어가 있는 브레이크의 '<끝>에 다시 열어요'다", () => {
    expect(todayNotice(week(), "BREAK", seoul("15:30"))).toBe(
      "17:00에 다시 열어요",
    );
    const twoBreaks = week({
      breaks: [
        { start: "09:30", end: "12:00" },
        { start: "14:30", end: "18:00" },
      ],
    });
    expect(todayNotice(twoBreaks, "BREAK", seoul("10:00"))).toBe(
      "12:00에 다시 열어요",
    );
    expect(todayNotice(twoBreaks, "BREAK", seoul("15:00"))).toBe(
      "18:00에 다시 열어요",
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
    expect(todayNotice(week(closedDay), "CLOSED", seoul("12:00"))).toBe(
      "오늘 휴무",
    );
  });

  it("영업 상태를 모르면 안내가 없다", () => {
    expect(todayNotice(week(), "UNKNOWN", seoul("12:00"))).toBeUndefined();
    expect(
      todayNotice(week(unknownDay), "UNKNOWN", seoul("12:00")),
    ).toBeUndefined();
  });
});

describe("hoursText", () => {
  it("영업시간을 '11:00 – 22:00'으로 보여 준다", () => {
    expect(hoursText(day("MON"))).toBe("11:00 – 22:00");
  });

  it("휴무일은 '휴무'다", () => {
    expect(hoursText(day("MON", closedDay))).toBe("휴무");
  });

  it("정보 없는 요일은 '휴무'가 아니라 '정보 없음'이다", () => {
    expect(hoursText(day("MON", unknownDay))).toBe("정보 없음");
  });

  it("00:00 – 00:00은 '24시간 영업'이다", () => {
    expect(hoursText(day("MON", { open: "00:00", close: "00:00" }))).toBe(
      "24시간 영업",
    );
  });

  it("마감 00:00은 '24:00'으로, 자정을 넘는 영업은 마감 시각 그대로 보여 준다", () => {
    expect(hoursText(day("MON", { close: "00:00" }))).toBe("11:00 – 24:00");
    expect(hoursText(day("MON", { open: "17:00", close: "02:00" }))).toBe(
      "17:00 – 02:00",
    );
  });
});

describe("hoursNotes", () => {
  it("브레이크타임과 라스트오더를 한 줄씩 보여 준다", () => {
    expect(hoursNotes(day("MON"))).toEqual([
      "15:00 – 17:00 브레이크타임",
      "14:30, 21:00 라스트오더",
    ]);
  });

  it("브레이크가 여럿이면 하나마다 한 줄이다", () => {
    expect(
      hoursNotes(
        day("MON", {
          breaks: [
            { start: "09:30", end: "12:00" },
            { start: "14:30", end: "18:00" },
          ],
          lastOrders: [],
        }),
      ),
    ).toEqual(["09:30 – 12:00 브레이크타임", "14:30 – 18:00 브레이크타임"]);
  });

  it("없는 줄은 빼고, 휴무일은 아무 줄도 없다", () => {
    expect(hoursNotes(day("MON", { breaks: [] }))).toEqual([
      "14:30, 21:00 라스트오더",
    ]);
    expect(hoursNotes(day("MON", { lastOrders: [] }))).toEqual([
      "15:00 – 17:00 브레이크타임",
    ]);
    expect(hoursNotes(day("MON", { closed: true }))).toEqual([]);
  });
});
