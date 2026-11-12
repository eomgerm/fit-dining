import { describe, expect, it } from "vitest";

import { areaLabel, areaText, radiusLabel } from "./meetup";

describe("모임 지역 글", () => {
  it("반경은 1km부터 km로 쓴다", () => {
    expect(radiusLabel(500)).toBe("500m");
    expect(radiusLabel(1000)).toBe("1km");
    expect(radiusLabel(5000)).toBe("5km");
  });

  it("지점 모임은 위치 이름에 반경을 붙이고, 이름이 없으면 반경만 쓴다", () => {
    expect(areaText({ kind: "STATION", name: "선릉" })).toBe("선릉역");
    expect(areaText({ kind: "POINT", name: "연동 근처", radiusM: 1000 })).toBe(
      "연동 근처 · 반경 1km",
    );
    expect(areaText({ kind: "POINT", radiusM: 500 })).toBe("반경 500m");
    expect(areaLabel({ kind: "POINT", name: "연동 근처" })).toBe("연동 근처");
  });
});
