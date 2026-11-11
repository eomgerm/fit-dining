import { describe, expect, it } from "vitest";

import { tasteRows, tasteSummary } from "./taste";

describe("취향 요약", () => {
  it("대기 화면 한 줄은 분위기, 음식, 매운 음식, 가격, 메뉴 순서다", () => {
    expect(
      tasteSummary({
        mood: "QUIET",
        likeFoods: ["KOREAN", "WESTERN"],
        noSpicy: true,
        priceCap: 20_000,
        wantMenu: "곱창",
      }),
    ).toEqual([
      "조용한 곳",
      "한식·양식",
      "매운 건 못 먹어요",
      "2만 원 이하",
      "곱창",
    ]);
  });

  it("상관없음과 빈 답은 줄에 넣지 않는다", () => {
    expect(tasteSummary({ mood: "ANY" })).toEqual([]);
    expect(tasteSummary(undefined)).toEqual([]);
    expect(tasteSummary({ priceCap: 15_000 })).toEqual(["15,000원 이하"]);
  });

  it("취향을 남긴 뒤 화면은 분위기와 음식 두 줄이다", () => {
    expect(
      tasteRows({ mood: "QUIET", likeFoods: ["KOREAN"], noSpicy: true }),
    ).toEqual([
      { label: "분위기", value: "조용하고 차분한 곳" },
      { label: "음식", value: "한식 · 매운 건 못 먹어요" },
    ]);
    expect(tasteRows(undefined)).toEqual([
      { label: "분위기", value: "상관없어요" },
      { label: "음식", value: "상관없어요" },
    ]);
  });
});
