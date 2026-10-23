import { describe, expect, it } from "vitest";

import type { PlaceSuggestion, PlaceSummary } from "./place-types";
import { actionFirst } from "./suggestions";

function place(id: number): PlaceSuggestion {
  const summary: PlaceSummary = {
    id,
    name: `장소 ${id}`,
    categoryGroup: "CAFE",
    station: "YEOKSAM",
    lat: 37.5,
    lng: 127.03,
  };
  return { type: "PLACE", place: summary };
}

const action: PlaceSuggestion = {
  type: "ACTION",
  label: "이 조건으로 추천받기",
};

describe("actionFirst", () => {
  it("응답 맨 뒤의 ACTION을 맨 위로 올리고 장소 순서는 그대로 둔다", () => {
    expect(actionFirst([place(2), place(1), action])).toEqual([
      action,
      place(2),
      place(1),
    ]);
  });

  it("이미 맨 위면 그대로다", () => {
    expect(actionFirst([action, place(1)])).toEqual([action, place(1)]);
  });

  it("ACTION이 없으면 장소만 순서대로 돌려준다", () => {
    expect(actionFirst([place(1), place(2)])).toEqual([place(1), place(2)]);
  });
});
