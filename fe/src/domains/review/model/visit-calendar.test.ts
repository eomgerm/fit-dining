import { describe, expect, it } from "vitest";

import {
  calendarWeeks,
  dayState,
  formatDay,
  formatVisitDate,
  monthsBetween,
} from "./visit-calendar";

describe("monthsBetween", () => {
  it("방문일 범위가 걸친 달을 순서대로 준다", () => {
    expect(monthsBetween("2026-09-21", "2026-10-21")).toEqual([
      { year: 2026, month: 9 },
      { year: 2026, month: 10 },
    ]);
    expect(monthsBetween("2026-12-15", "2027-01-15")).toEqual([
      { year: 2026, month: 12 },
      { year: 2027, month: 1 },
    ]);
    expect(monthsBetween("2027-02-01", "2027-02-28")).toEqual([
      { year: 2027, month: 2 },
    ]);
  });

  it("min이 max보다 뒤거나 날짜가 깨졌으면 멈추지 않고 빈 목록을 준다", () => {
    expect(monthsBetween("2026-11-01", "2026-10-01")).toEqual([]);
    expect(monthsBetween("bad", "2026-10-01")).toEqual([]);
    expect(monthsBetween("2026-09-01", "bad")).toEqual([]);
  });
});

describe("calendarWeeks", () => {
  it("일요일부터 주를 나누고 앞뒤 빈칸을 채운다", () => {
    const weeks = calendarWeeks({ year: 2026, month: 10 });

    expect(weeks).toHaveLength(5);
    expect(weeks[0]).toEqual([
      null,
      null,
      null,
      null,
      "2026-10-01",
      "2026-10-02",
      "2026-10-03",
    ]);
    expect(weeks[4].slice(-1)).toEqual(["2026-10-31"]);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
  });
});

describe("dayState", () => {
  const range = { min: "2026-09-21", max: "2026-10-21" };

  it("범위 경계는 고를 수 있고 밖은 막는다", () => {
    expect(dayState("2026-09-21", range, [])).toBe("available");
    expect(dayState("2026-10-21", range, [])).toBe("available");
    expect(dayState("2026-09-20", range, [])).toBe("outside");
    expect(dayState("2026-10-22", range, [])).toBe("outside");
  });

  it("이미 쓴 날은 작성함으로 막는다", () => {
    expect(dayState("2026-10-12", range, ["2026-10-12"])).toBe("reviewed");
  });
});

describe("formatVisitDate", () => {
  it("요일을 붙이고 오늘이면 앞에 오늘을 붙인다", () => {
    expect(formatDay("2026-10-17")).toBe("10월 17일 (토)");
    expect(formatVisitDate("2026-10-19", "2026-10-19")).toBe(
      "오늘 · 10월 19일 (월)",
    );
    expect(formatVisitDate("2026-10-17", "2026-10-19")).toBe("10월 17일 (토)");
  });
});
