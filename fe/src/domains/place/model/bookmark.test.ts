import { describe, expect, it } from "vitest";

import {
  CATEGORY_TABS,
  emptyCategoryText,
  parseCategory,
  placeDetailHref,
  savedPlacesHref,
} from "./bookmark";
import { CATEGORY_LABELS } from "./place-labels";

describe("bookmark 모델", () => {
  it("업종 탭은 업종 이름표에서 만들어진다", () => {
    expect(CATEGORY_TABS).toEqual(Object.keys(CATEGORY_LABELS));
  });

  it("받침에 맞는 조사로 빈 업종 안내를 만든다", () => {
    expect(emptyCategoryText("RESTAURANT")).toBe("저장한 식당이 없어요");
    expect(emptyCategoryText("CAFE")).toBe("저장한 카페가 없어요");
    expect(emptyCategoryText("BAR")).toBe("저장한 술집이 없어요");
  });

  it("모르는 category는 전체 탭이다", () => {
    expect(parseCategory("CAFE")).toBe("CAFE");
    expect(parseCategory("toString")).toBeUndefined();
    expect(parseCategory(null)).toBeUndefined();
  });

  it("저장한 장소 화면과 상세 주소", () => {
    expect(savedPlacesHref()).toBe("/?view=saved");
    expect(savedPlacesHref("BAR")).toBe("/?view=saved&category=BAR");
    expect(placeDetailHref(3)).toBe("/place?id=3");
    expect(placeDetailHref(3, true)).toBe("/place?id=3&from=saved");
  });
});
