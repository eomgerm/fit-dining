import { describe, expect, it } from "vitest";

import {
  canSubmit,
  EMPTY_FORM,
  nextHeadcount,
  previousHeadcount,
  toRequest,
  type CreateForm,
} from "./create-form";

const NOON = new Date("2026-11-11T03:00:00Z");
const SEOLLEUNG = { kind: "STATION" as const, name: "선릉" };

describe("모임 만들기 입력", () => {
  it("인원은 정하지 않음에서 2명으로 가고 8명에서 멈추며, 2명에서 줄이면 정하지 않음이다", () => {
    expect(nextHeadcount(null)).toBe(2);
    expect(nextHeadcount(7)).toBe(8);
    expect(nextHeadcount(8)).toBe(8);
    expect(previousHeadcount(3)).toBe(2);
    expect(previousHeadcount(2)).toBeNull();
    expect(previousHeadcount(null)).toBeNull();
  });

  it("지역이 없으면 보낼 수 없다", () => {
    expect(canSubmit(EMPTY_FORM, NOON)).toBe(false);
    expect(canSubmit({ ...EMPTY_FORM, area: SEOLLEUNG }, NOON)).toBe(true);
  });

  it("오늘의 지난 시각이면 보낼 수 없다", () => {
    const form: CreateForm = {
      ...EMPTY_FORM,
      area: SEOLLEUNG,
      date: "2026-11-11",
      time: "11:30",
    };
    expect(canSubmit(form, NOON)).toBe(false);
    expect(canSubmit({ ...form, time: "19:00" }, NOON)).toBe(true);
  });

  it("요청에는 고른 항목만 넣고 설명은 앞뒤 공백을 지운다", () => {
    expect(
      toRequest({ ...EMPTY_FORM, area: SEOLLEUNG, description: "  " }),
    ).toEqual({ area: SEOLLEUNG, category: "RESTAURANT" });
    expect(
      toRequest({
        area: SEOLLEUNG,
        category: "BAR",
        date: "2026-11-14",
        time: "19:00",
        headcount: 4,
        description: " 회식 ",
      }),
    ).toEqual({
      area: SEOLLEUNG,
      category: "BAR",
      date: "2026-11-14",
      time: "19:00",
      headcount: 4,
      description: "회식",
    });
  });
});
