import { describe, expect, it } from "vitest";

import type { FormTag } from "./review";
import { disabledTagCodes, hasGoodTag, toggleTag } from "./review-tags";

const tag = (code: string, group: string): FormTag => ({
  code,
  label: code,
  group,
  displayGroup: "분위기",
});

const good = [tag("QUIET_GOOD", "NOISE"), tag("COZY_GOOD", "COZY")];
const bad = [
  tag("LIVELY_BAD", "NOISE"),
  tag("QUIET_BAD", "NOISE"),
  tag("COZY_BAD", "COZY"),
];
const all = [...good, ...bad];

describe("toggleTag", () => {
  it("없으면 더하고 있으면 뺀다", () => {
    expect(toggleTag([], "QUIET_GOOD")).toEqual(["QUIET_GOOD"]);
    expect(toggleTag(["QUIET_GOOD", "COZY_BAD"], "QUIET_GOOD")).toEqual([
      "COZY_BAD",
    ]);
  });
});

describe("disabledTagCodes", () => {
  it("좋았어요를 고르면 다른 페이지의 같은 그룹 아쉬웠어요를 막는다", () => {
    expect([...disabledTagCodes(["COZY_GOOD"], all)]).toEqual(["COZY_BAD"]);
  });

  it("소음 축은 네 태그가 한 그룹이다", () => {
    expect([...disabledTagCodes(["QUIET_GOOD"], all)].sort()).toEqual([
      "LIVELY_BAD",
      "QUIET_BAD",
    ]);
  });

  it("아무것도 고르지 않으면 막는 태그가 없다", () => {
    expect(disabledTagCodes([], all).size).toBe(0);
  });
});

describe("hasGoodTag", () => {
  it("좋았어요를 하나 이상 골라야 참이다", () => {
    expect(hasGoodTag(["COZY_BAD"], good)).toBe(false);
    expect(hasGoodTag(["COZY_BAD", "QUIET_GOOD"], good)).toBe(true);
  });
});
