import { describe, expect, it } from "vitest";

import { canSave, formFromInfo, toUpdateRequest } from "./edit-form";
import type { MeetupInfo } from "./meetup";

const INFO: MeetupInfo = {
  area: { kind: "STATION", name: "선릉" },
  category: "RESTAURANT",
  date: "2026-11-10",
  time: "19:00",
  headcount: 4,
  description: "회식",
  expiresOn: "2026-11-17",
};
const NOON = new Date("2026-11-11T03:00:00Z");

describe("모임 정보 수정 값", () => {
  it("스냅숏의 모임 정보로 채운다", () => {
    expect(formFromInfo({ ...INFO, headcount: undefined })).toEqual({
      area: { kind: "STATION", name: "선릉" },
      category: "RESTAURANT",
      date: "2026-11-10",
      time: "19:00",
      headcount: null,
      description: "회식",
    });
  });

  it("날짜를 바꾸지 않았으면 지난 날짜여도 다른 항목을 저장할 수 있다", () => {
    const initial = formFromInfo(INFO);
    expect(canSave({ ...initial, headcount: 5 }, initial, NOON, false)).toBe(
      true,
    );
    expect(
      canSave({ ...initial, date: "2026-11-09" }, initial, NOON, false),
    ).toBe(false);
  });

  it("날짜·시간만 고칠 때는 날짜를 비울 수 없다", () => {
    const initial = formFromInfo({ ...INFO, date: "2026-11-14" });
    expect(
      canSave(
        { ...initial, date: undefined, time: undefined },
        initial,
        NOON,
        true,
      ),
    ).toBe(false);
  });

  it("날짜를 바꾸지 않았으면 날짜와 시각을 보내지 않는다", () => {
    const initial = formFromInfo(INFO);
    expect(
      toUpdateRequest({ ...initial, headcount: null }, initial, false),
    ).toEqual({
      area: { kind: "STATION", name: "선릉" },
      category: "RESTAURANT",
      headcount: null,
      description: "회식",
    });
    expect(toUpdateRequest(initial, initial, true)).toEqual({});
  });
});
